// priority: -10000
// Exports item names that depend on NBT/data components (potions, enchanted
// books, tipped arrows, etc.). These can only be enumerated client-side: they
// live in the creative search tab, which is populated after joining a world.
// The server export (SERVER_export_modpack_data.js) only writes base names.
//
// We read CreativeModeTabs.searchTab().getDisplayItems() directly rather than
// Item.getList(): that KubeJS helper is backed by a shared static cache that
// the (empty) server-side call already populated, so it would return stale data.

// Java classes are loaded once at module scope. They must NOT be declared with
// `const`/`let` inside a `try` block: KubeJS's Rhino double-hoists those and
// throws "redeclaration of var", which is what silently disabled the registry
// serialization context (leaving every nbt field null).
const McClient = Java.loadClass('net.minecraft.client.Minecraft')
const JsonOpsCls = Java.loadClass('com.mojang.serialization.JsonOps')
const RegistryOpsCls = Java.loadClass('net.minecraft.resources.RegistryOps')
const ItemStackCls = Java.loadClass('net.minecraft.world.item.ItemStack')
const CreativeModeTabsCls = Java.loadClass('net.minecraft.world.item.CreativeModeTabs')
// The player-facing tooltip flag. The Default enum's constants aren't reachable
// through the KubeJS Rhino remapper (neither the NORMAL field nor values()), and
// java.lang.Class is blocked by KubeJS's class filter, so we can't reflect them.
// The TooltipFlag *interface* exposes NORMAL as a plain public-static-final field
// (= Default.NORMAL, the non-advanced flag), which the remapper does surface.
const TooltipFlagCls = Java.loadClass('net.minecraft.world.item.TooltipFlag')
// Screen exposes the live keyboard-modifier queries (hasShiftDown/hasControlDown)
// that mods like GTCEU consult when building a tooltip: their "Hold SHIFT to
// show ... Info" lines are only appended while the key is physically down. We
// can't spoof those (GLFW has no set-key API and hasShiftDown reads the key
// live), so the export instead records WHICH modifier was held during the
// reload and writes the expanded tooltip under a modifier-specific key.
const ScreenCls = Java.loadClass('net.minecraft.client.gui.screens.Screen')

// The export below writes into the single shared file local/modpack_data.json,
// contributing to the item_data key: the per-variant display names, tooltips and
// the source mod for every item in the creative search tab. The server export
// supplies the rest of item_data (tags + base names) plus fluid_data, tag_data
// and recipe_data. Because the server and client scripts run separately, the two
// halves of item_data are DEEP-merged per id and per variant so neither side
// clobbers the other (variants are matched by their NBT payload).

// Merge one incoming entry into an existing one. Scalar fields are owned by
// whichever script can see them (`mod` only the client, `tags` only the server),
// so each is filled from incoming when provided. Variants are matched across
// scripts by their NBT payload: the server seeds a single base variant (nbt
// null) with the registry name; the client fills that variant's tooltip and
// appends any NBT-distinct variants.
function mergeEntry(target, incoming) {
    if (incoming.mod !== undefined && incoming.mod !== null) target.mod = incoming.mod
    if (incoming.tags !== undefined) target.tags = incoming.tags
    if (incoming.variants && incoming.variants.length) {
        if (!target.variants) target.variants = []
        let index = {}
        target.variants.forEach(v => {
            index[JSON.stringify(v.nbt === undefined ? null : v.nbt)] = v
        })
        incoming.variants.forEach(iv => {
            let sig = JSON.stringify(iv.nbt === undefined ? null : iv.nbt)
            let tv = index[sig]
            if (!tv) {
                target.variants.push(iv)
                index[sig] = iv
            } else {
                if ((tv.name === undefined || tv.name === null) && iv.name != null) tv.name = iv.name
                if (tv.tooltip === undefined && iv.tooltip !== undefined) tv.tooltip = iv.tooltip
            }
        })
    }
}

// Deep-merge a map of id -> entry (item_data / fluid_data) into another.
function deepMergeDataMap(target, source) {
    Object.keys(source).forEach(id => {
        if (!target[id]) target[id] = source[id]
        else mergeEntry(target[id], source[id])
    })
}

function mergeModpackData(updates) {
    let existing = {}
    try {
        // JsonIO.read() returns a Java Map whose toString() isn't valid JSON;
        // readJson() gives a JsonElement we can stringify and parse cleanly.
        let current = JsonIO.readJson('local/modpack_data.json')
        if (current && !current.isJsonNull()) {
            existing = JSON.parse(JsonIO.toString(current))
        }
    } catch (e) {
        existing = {}
    }
    Object.keys(updates).forEach(k => {
        if (k === 'item_data' || k === 'fluid_data') {
            if (!existing[k]) existing[k] = {}
            deepMergeDataMap(existing[k], updates[k])
        } else {
            existing[k] = updates[k]
        }
    })
    JsonIO.write('local/modpack_data.json', existing)
}

// Pull the distinguishing payload off a stack. The data that makes two stacks
// of the same item id differ (potion contents, banner patterns, enchantments,
// turbine material, computercraft upgrades, ...) lives in the stack's NBT. The
// item's own getTag()/getComponents() accessors aren't reachable through the
// KubeJS Rhino remapper, so instead we serialize the whole stack with
// ItemStack.CODEC using the world's registry access (needed to resolve holder
// references like potion/enchantment ids). We encode through JsonOps and parse
// the data sub-object into a native JS object so it is written as real nested
// JSON rather than an opaque SNBT string. On 1.20.x that sub-object is "tag";
// on 1.20.5+ it's "components" -- we look for either. Returns the object, or
// null when the stack carries no extra data. `ops` is built once by the caller.
function stackData(stack, ops, id) {
    if (!ops) return null

    try {
        let res = ItemStackCls.CODEC.encodeStart(ops, stack)
        let jsonOpt = res.result()
        if (!jsonOpt.isPresent()) {
            let err = res.error()
            console.error('[NBT EXPORT] failed to encode ' + id + ': '
                + (err.isPresent() ? err.get().message() : 'unknown error'))
            return null
        }
        // The encoded value is a JSON object {id, Count, tag/components}; only
        // the data sub-object distinguishes variants of the same item id
        // ("tag" on 1.20.x, "components" on 1.20.5+). Parse it into a real JS
        // object so it serializes as nested JSON, not an SNBT string.
        let root = jsonOpt.get().getAsJsonObject()
        let data = root.has('tag') ? root.get('tag')
            : (root.has('components') ? root.get('components') : null)
        return data ? JSON.parse(data.toString()) : null
    } catch (e) {
        console.error('[NBT EXPORT] failed to encode ' + id + ': ' + e)
        return null
    }
}

// Build the RegistryOps used to serialize stacks. Requires being in a world so
// the client level's registry access is available; returns null otherwise (the
// caller then falls back to legacy NBT).
function nbtSerializationContext() {
    try {
        let level = McClient.getInstance().level
        if (!level) return null
        return RegistryOpsCls.create(JsonOpsCls.INSTANCE, level.registryAccess())
    } catch (e) {
        console.error('[NBT EXPORT] could not build registry serialization context: ' + e)
        return null
    }
}

// Minecraft color/format codes are a section sign (§) followed by one char. We
// strip them only to inspect a line's text (hint/blank detection); the kept
// line keeps its original formatting.
const FORMAT_CODE = /\u00a7./g

// True for a line that renders empty (only whitespace and/or format codes).
function isBlankLine(text) {
    return text.replace(FORMAT_CODE, '').trim().length === 0
}

// True for "reveal more" hint prompts such as "Hold CTRL to see tags",
// "Hold SHIFT to show Tool Info", "Hold [W] to Ponder", "Press [SHIFT]". These
// are interactive UI prompts to expand the tooltip, not part of the item's
// description. Genuine usage instructions ("Hold left click to dismantle",
// "Hold Shift + Right Click to Open") are intentionally NOT matched: they lack
// the reveal-info phrasing and aren't bare key prompts.
function isHintLine(text) {
    // Work on the de-formatted text; also drop a leading "- " bullet and any
    // surrounding < > brackets so wrapped prompts still match.
    let s = text.replace(FORMAT_CODE, '').trim()
    s = s.replace(/^-\s+/, '').replace(/^<\s*/, '').replace(/\s*>$/, '').trim()
    if (!/^(hold|press)\b/i.test(s)) return false
    // "...to show/see/view/ponder ..." or "...for more/info/details/summary ...".
    if (/\b(to\s+(show|see|view|ponder)|for\s+(more|info|information|details?|summary))\b/i.test(s)) return true
    // Bare key prompt with nothing else, e.g. "Hold Shift", "Press [SHIFT]".
    if (/^(hold|press)\s*\[?\s*(left\s+)?(shift|ctrl|control)\s*\]?[.!]?$/i.test(s)) return true
    return false
}

// Read the description/tooltip lines off a stack. Tooltips are client-only:
// they're assembled by Item.appendHoverText from the stack's data (and often
// need a world for holder lookups), which is why this lives in the client
// export. The first tooltip line is the item's display name -- already covered
// by the name/NBT exports -- so we drop it. We also drop "reveal more" hint
// lines (see isHintLine) and trim leading/trailing blank spacer lines; internal
// blank lines are kept so the description's structure is preserved.
function tooltipLines(stack, player, flag, id) {
    try {
        let lines = stack.getTooltipLines(player, flag)
        let out = []
        for (let i = 1; i < lines.size(); i++) {
            let text = lines.get(i).getString()
            if (isHintLine(text)) continue
            out.push(text)
        }
        while (out.length && isBlankLine(out[0])) out.shift()
        while (out.length && isBlankLine(out[out.length - 1])) out.pop()
        // Forge appends the source mod's display name as the final tooltip line
        // (rendered blue+italic). Pull it into its own `mod` field so `tooltip`
        // holds only the description.
        let mod = out.length ? out.pop() : null
        return { tooltip: out, mod: mod }
    } catch (e) {
        console.error('[TOOLTIP EXPORT] failed to read tooltip for ' + id + ': ' + e)
        return { tooltip: [], mod: null }
    }
}

// Export the client's half of item_data for every item in the creative search
// tab: each stack contributes a variant { name, nbt, tooltip? }, and the source
// mod is hoisted to the id level (it doesn't change with NBT). The server
// supplies each id's tags and base registry name, which are deep-merged with
// these variants (matched by NBT payload) in the shared local/modpack_data.json.
// Unlike a plain name export, this keeps EVERY id (not just those whose variants
// differ), since a description is useful even when an item has a single variant.
//
// Some tooltips gate their useful content behind a held modifier (e.g. GTCEU
// coils: "Hold SHIFT to show Coil Bonus Info"; tag viewers: "Hold CTRL to see
// tags"). That content is generated only while the key is physically down, so
// hold SHIFT + Cmd together during the reload to capture the fully-expanded
// tooltips in a single pass. Holding both makes hasShiftDown() and
// hasControlDown() true at once, so shift- and ctrl-gated lines are both
// emitted. (On macOS "control" is Cmd -- Minecraft maps hasControlDown to the
// SUPER key on OSX -- matching how the mods themselves gate their CTRL content.)
//
// heldModifiers is only used to annotate the log line so you can confirm the
// hold registered; the result is always written under item_data regardless.
function heldModifiers() {
    let parts = []
    try {
        if (ScreenCls.hasShiftDown()) parts.push('SHIFT')
        if (ScreenCls.hasControlDown()) parts.push('CTRL/Cmd')
        if (ScreenCls.hasAltDown()) parts.push('ALT')
    } catch (e) {
        console.error('[ITEM DATA EXPORT] could not read modifier keys: ' + e)
    }
    return parts
}

function exportItemData() {
    let displayItems
    try {
        displayItems = CreativeModeTabsCls.searchTab().getDisplayItems()
    } catch (e) {
        console.error('[ITEM DATA EXPORT] creative search tab not ready: ' + e)
        return
    }

    if (!displayItems || displayItems.size() === 0) {
        console.warn('[ITEM DATA EXPORT] search tab is empty; skipping (open creative once or relog if this persists)')
        return
    }

    let ops = nbtSerializationContext()
    let player = McClient.getInstance().player
    let flag = TooltipFlagCls.NORMAL
    // Which modifiers are held right now, for the log line only. Read once up
    // front; the capture loop runs in a single synchronous burst so the state is
    // stable, and the key(s) must be held throughout for the gated lines to appear.
    let modifiers = heldModifiers()

    // Group every search-tab stack by item id, collecting its distinct variants
    // (name + tooltip + the NBT payload that distinguishes them). The source mod
    // is the same for every variant of an id, so it's hoisted to the id level.
    let entries = {}
    let seen = {}
    displayItems.forEach(stack => {
        let id
        try {
            id = Item.getId(stack.getItem()).toString()
        } catch (e) {
            return
        }
        if (!entries[id]) entries[id] = { variants: [] }

        let name
        try {
            name = stack.getHoverName().getString()
        } catch (e) {
            name = id
        }

        // The distinguishing data lives in the stack's NBT (same key the server
        // uses to match its base variant).
        let nbt = stackData(stack, ops, id)
        let t = tooltipLines(stack, player, flag, id)
        if (t.mod != null && entries[id].mod == null) entries[id].mod = t.mod

        // Dedupe on the (name, nbt, tooltip) tuple so identical variants collapse
        // but genuinely different ones are all recorded.
        let sig = id + '\u0000' + name + '\u0000' + JSON.stringify(nbt)
            + '\u0000' + JSON.stringify(t.tooltip)
        if (seen[sig]) return
        seen[sig] = true
        // Omit `tooltip` when the description is empty (only the mod line was
        // present), keeping just name + nbt.
        let variant = { name: name, nbt: nbt }
        if (t.tooltip.length) variant.tooltip = t.tooltip
        entries[id].variants.push(variant)
    })

    // Drop ids with a huge number of variants (pipe/cable microblocks, covers,
    // facades): their names/tooltips are derived from the contained block and
    // just add noise. The server still contributes their base entry.
    let result = {}
    Object.keys(entries).forEach(id => {
        if (entries[id].variants.length > 250) return
        result[id] = entries[id]
    })

    console.log('[ITEM DATA EXPORT] ' + Object.keys(entries).length + ' ids in search tab, '
        + Object.keys(result).length + ' exported under item_data'
        + (modifiers.length ? ' (captured with ' + modifiers.join('+') + ' held)'
                            : ' (no modifier held -- hold SHIFT+Cmd to capture gated content)'))
    return { item_data: result }
}

// Runs only on `/kubejs reload client_scripts`, which re-evaluates this file.
// We do NOT hook ClientEvents.loggedIn: the creative search tab is only
// populated after the creative inventory has been opened at least once, so a
// world-join export would see an empty tab. Open creative once, then reload.
//
// The single export merges into the shared local/modpack_data.json under
// item_data; it returns undefined when it bails early (no world / empty search
// tab), so guard before merging.
if (Client.player) {
    let payload = exportItemData()
    if (payload) mergeModpackData(payload)
}
