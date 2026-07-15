// priority: -10000

// Every export below writes into a single shared file, local/modpack_data.json,
// storing its payload under one of four top-level keys: item_data, fluid_data,
// tag_data, recipe_data. The client export contributes the per-variant names,
// tooltips and source mod for item_data. Because the server and client scripts
// run separately, each write reads the existing file first and merges, so
// neither side clobbers the other's data.
//
// item_data / fluid_data are assembled from BOTH scripts (the server supplies
// tags + base names; the client supplies per-NBT-variant names, tooltips and the
// source mod), so those two keys are DEEP-merged per id and per variant rather
// than replaced wholesale. Every other key (tag_data, recipe_data) is produced
// by a single script and is replaced outright.

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

// Java classes are loaded once at module scope. They must NOT be declared with
// `const`/`let` inside a `try`/event block: KubeJS's Rhino double-hoists those
// and throws "redeclaration of var".
const $BuiltInRegistries = Java.loadClass('net.minecraft.core.registries.BuiltInRegistries')
const $ArrayList = Java.loadClass('java.util.ArrayList')
// Used to give script-added recipes a fresh JSON object before serialization
// (their `json` field is null until KubeJS's registration pass runs).
const $JsonObject = Java.loadClass('com.google.gson.JsonObject')

// Base item_data entry for every registered item id: its reverse tag list plus a
// single base variant carrying the registry hover name (nbt null). The client
// export deep-merges the per-variant tooltips/names and the source mod on top.
// We enumerate ids straight from the ITEM registry (the same source the tag
// export uses, which is why tags work) rather than the KubeJS Item.getTypeList()
// helper, which isn't available in every KubeJS build and throws here --
// previously aborting the whole export. NBT-dependent names (potions, enchanted
// books, etc.) can't be seen here because the creative search tab isn't
// populated server-side; the client export supplies those variants.
function buildItemData(itemToTags) {
    let data = {}
    let registry = $BuiltInRegistries.ITEM
    // Copy the key set into a public ArrayList; Rhino can't iterate the
    // registry's internal Set view directly (same reason collectTags does it).
    let ids = new $ArrayList(registry.keySet())
    for (let i = 0; i < ids.size(); i++) {
        let id = ids.get(i)
        let key = id.toString()
        let name
        try {
            name = Item.of(id).getHoverName().getString()
        } catch (e) {
            name = key
        }
        data[key] = {
            tags: itemToTags[key] || [],
            variants: [{ name: name, nbt: null }]
        }
    }
    return { item_data: data }
}

function collectTags(registry) {
    let tagToEntries = {}
    let entryToTags = {}

    // Copy the tag stream into a public ArrayList; Rhino can't reflect on
    // the package-private internal Stream classes directly.
    let tagKeys = new $ArrayList(registry.getTagNames().toList())
    for (let i = 0; i < tagKeys.size(); i++) {
        let tagKey = tagKeys.get(i)
        let tagId = tagKey.location().toString()
        let entries = []

        let optional = registry.getTag(tagKey)
        if (optional.isPresent()) {
            let holderSet = optional.get()
            let count = holderSet.size()
            for (let j = 0; j < count; j++) {
                let id = registry.getKey(holderSet.get(j).value()).toString()
                entries.push(id)
                if (!entryToTags[id]) entryToTags[id] = []
                entryToTags[id].push(tagId)
            }
        }

        tagToEntries[tagId] = entries
    }

    return { tagToEntries: tagToEntries, entryToTags: entryToTags }
}

// Collect item and fluid tags once and shape them for the new format. The
// forward maps (tag -> entries) live under the top-level tag_data key; the
// reverse maps (entry -> tags) are returned separately so buildItemData /
// buildFluidData can fold them into each entry's `tags` field.
function buildTagData() {
    let items = collectTags($BuiltInRegistries.ITEM)
    let fluids = collectTags($BuiltInRegistries.FLUID)

    return {
        itemToTags: items.entryToTags,
        fluidToTags: fluids.entryToTags,
        tagData: {
            tags_to_items: items.tagToEntries,
            tags_to_fluids: fluids.tagToEntries
        }
    }
}

// Base fluid_data entry for every fluid that carries at least one tag. Mirrors
// the item_data shape so fluid names/tooltips can be deep-merged in later (from
// a future client fluid export) with no structural change: `variants` is left
// empty for now, since fluid names/tooltips aren't exported yet.
function buildFluidData(fluidToTags) {
    let data = {}
    Object.keys(fluidToTags).forEach(id => {
        data[id] = {
            tags: fluidToTags[id],
            variants: []
        }
    })
    return { fluid_data: data }
}

// Determine the real recipe type id for a freshly-added recipe, whose own `type`
// field serializes as the placeholder "unknown" at this stage. Shaped/shapeless
// crafting are unambiguous from the serialized structure, so we read them
// directly (this reliably covers crafting-table recipes like the Iron Jetpacks
// tiers). Anything else falls back to the built recipe's serializer id, which
// matches the datapack `type` convention (e.g. "gtceu:assembly_line"). Returns
// null when the type can't be determined, leaving the existing value untouched.
function resolveRecipeType(r) {
    let j = r.json
    if (j.has('pattern') && j.has('key')) {
        return 'minecraft:crafting_shaped'
    }
    if (j.has('ingredients') && !j.has('pattern')) {
        return 'minecraft:crafting_shapeless'
    }
    // The recipe's own type id, when KubeJS has resolved it. This is the case for
    // typed builders like `event.recipes.gtceu.<machine>(...)` (giving e.g.
    // "gtceu:macerator"), but not for the generic `event.shaped()` shortcut, whose
    // type stays the placeholder "unknown" -- hence the structural checks above.
    try {
        let t = r.getType()
        if (t) {
            let s = t.toString()
            if (s && s.indexOf('unknown') < 0) {
                return s
            }
        }
    } catch (ie) {
        // No resolved type id; fall through.
    }
    try {
        let orig = r.getOriginalRecipe()
        if (orig) {
            let key = $BuiltInRegistries.RECIPE_SERIALIZER.getKey(orig.getSerializer())
            if (key) {
                return key.toString()
            }
        }
    } catch (te) {
        // Built recipe unavailable; leave the type as-is.
    }
    return null
}

// Full export. Recipe JSON is only reachable through the recipes event, so this
// runs the recipe export alongside the name/tag exports. Fires on world load
// and on `/reload` (a datapack reload).
//
// Each section is built into a single payload and written with ONE
// mergeModpackData call. JsonIO.write is buffered, so writing per-key would make
// each merge re-read the same stale (pre-tick) file and the last write would
// clobber the earlier ones. Each section is also wrapped in its own try/catch so
// a failure in one (e.g. a malformed recipe) can't drop the others.
ServerEvents.recipes(event => {
    let payload = {}

    // Tags are built first: their reverse maps feed the `tags` field of every
    // item_data / fluid_data entry, and the forward maps become tag_data. A
    // failure in tag collection still leaves the base names intact (empty tags).
    let tags = { itemToTags: {}, fluidToTags: {}, tagData: { tags_to_items: {}, tags_to_fluids: {} } }
    try {
        tags = buildTagData()
    } catch (e) {
        console.error('[MODPACK EXPORT] tag export failed: ' + e)
    }

    try {
        Object.assign(payload, buildItemData(tags.itemToTags))
    } catch (e) {
        console.error('[MODPACK EXPORT] item data failed: ' + e)
    }

    try {
        Object.assign(payload, buildFluidData(tags.fluidToTags))
    } catch (e) {
        console.error('[MODPACK EXPORT] fluid data failed: ' + e)
    }

    payload.tag_data = tags.tagData

    try {
        let recipes = []

        // Serialize one recipe and append its JSON to the list.
        //
        // `originalRecipes` (loaded from datapacks) already carry a populated
        // `json` field. Script-added recipes (`event.shaped`, `event.recipes.*`,
        // etc.) are flagged `newRecipe` and only get serialized into `json`
        // during KubeJS's post-event registration pass, which runs AFTER this
        // handler. Until then their `json` is null, so we give them a fresh
        // JsonObject and serialize now -- this populates their components (result,
        // key, ingredients) including NBT outputs, e.g. the Iron Jetpacks tiers.
        let collectRecipe = function (r) {
            try {
                if (r.removed) return
                if (r.newRecipe) {
                    if (!r.json) {
                        r.json = new $JsonObject()
                    }
                    r.serialize()
                    // serialize() leaves `type` as the placeholder "unknown" for
                    // freshly-added recipes (their RecipeTypeFunction isn't resolved
                    // yet). Recover the real type so they group correctly in the
                    // viewer instead of all landing under an "unknown" category.
                    let typeId = resolveRecipeType(r)
                    if (typeId) {
                        r.json.addProperty('type', typeId)
                    }
                }
                if (r.json) {
                    recipes.push(JSON.parse(r.json.toString()))
                }
            } catch (re) {
                // Skip a single unserializable recipe rather than aborting.
            }
        }

        // forEachRecipe only streams `originalRecipes`; it never visits the
        // separate `addedRecipes` collection, which is why every script-added
        // recipe was missing from the export. Walk both sources.
        event.forEachRecipe({}, function (r) { collectRecipe(r) })

        let added = event.addedRecipes
        if (added) {
            let it = added.iterator()
            while (it.hasNext()) {
                collectRecipe(it.next())
            }
        }

        payload.recipe_data = { recipes: recipes }
    } catch (e) {
        console.error('[MODPACK EXPORT] recipe export failed: ' + e)
    }

    mergeModpackData(payload)
})

// KubeJS has no `Utils.staticServer` binding; the running MinecraftServer is
// reached through the mod loader's ServerLifecycleHooks instead. The class lives
// under a different package on Forge vs NeoForge, so try both and treat a
// missing class (wrong loader) as "no server".
function getRunningServer() {
    let classNames = [
        'net.minecraftforge.server.ServerLifecycleHooks',
        'net.neoforged.neoforge.server.ServerLifecycleHooks'
    ]
    for (let i = 0; i < classNames.length; i++) {
        try {
            return Java.loadClass(classNames[i]).getCurrentServer()
        } catch (e) {
            // Class not present on this loader; try the next candidate.
        }
    }
    return null
}

// `/kubejs reload server_scripts` re-evaluates this file but does NOT fire
// ServerEvents.recipes (it reloads scripts only, not datapacks/recipes). If a
// server is already running, regenerate the registry-based exports now so a
// script reload alone refreshes item_data/fluid_data/tag_data without
// rejoining. Recipe data still needs a datapack reload (`/reload`) to refresh,
// since recipe JSON is only exposed through the recipes event.
//
// This same registry read is ALSO the reliable source for tags: item/fluid tags
// are only bound to BuiltInRegistries once the server has finished loading. The
// ServerEvents.recipes handler above runs DURING the datapack reload -- before
// tag binding -- so on a fresh world load it sees only the handful of
// code-registered tags (all empty). ServerEvents.loaded fires after startup
// completes, when tags are fully bound, so re-running the export there
// overwrites those empty tags with the complete set. (recipe_data, written by
// the recipes event, is preserved by the read-merge-write.)
function exportRegistryData() {
    let payload = {}
    let tags = { itemToTags: {}, fluidToTags: {}, tagData: { tags_to_items: {}, tags_to_fluids: {} } }
    try {
        tags = buildTagData()
    } catch (e) {
        console.error('[MODPACK EXPORT] tag export failed: ' + e)
    }
    try {
        Object.assign(payload, buildItemData(tags.itemToTags))
    } catch (e) {
        console.error('[MODPACK EXPORT] item data failed: ' + e)
    }
    try {
        Object.assign(payload, buildFluidData(tags.fluidToTags))
    } catch (e) {
        console.error('[MODPACK EXPORT] fluid data failed: ' + e)
    }
    payload.tag_data = tags.tagData
    mergeModpackData(payload)
}

ServerEvents.loaded(event => {
    exportRegistryData()
})

if (getRunningServer()) {
    exportRegistryData()
}