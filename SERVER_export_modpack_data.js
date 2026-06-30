// priority: -10000
ServerEvents.recipes(event => {
    // Base name for every registered item id. getTypeList() returns unique
    // registry ids, so it covers items even if they're not in a creative tab.
    // NBT-dependent names (potions, enchanted books, etc.) can't be seen here
    // because the creative search tab isn't populated server-side; those are
    // exported by client_scripts/CLIENT_export_modpack_data.js instead.
    let names = {}
    Item.getTypeList().forEach(id => {
        try {
            names[id.toString()] = Item.of(id).getHoverName().getString()
        } catch (e) {
            names[id.toString()] = id.toString()
        }
    })
    JsonIO.write('local/item_names.json', names)
})

// priority: -10000
ServerEvents.recipes(event => {
    let recipes = []
    event.forEachRecipe({}, r => {
        recipes.push(JSON.parse(r.json.toString()))
    })

    JsonIO.write('local/recipe_data.json', { recipes: recipes })
})

// priority: -10000
ServerEvents.recipes(event => {
    console.log("STARTING TAG EXPORT")
    const $BuiltInRegistries = Java.loadClass('net.minecraft.core.registries.BuiltInRegistries')
    const $ArrayList = Java.loadClass('java.util.ArrayList')

    function exportTags(registry) {
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

    let items = exportTags($BuiltInRegistries.ITEM)
    let fluids = exportTags($BuiltInRegistries.FLUID)

    JsonIO.write('local/item_tags.json', {
        tag_to_items: items.tagToEntries,
        item_to_tags: items.entryToTags
    })
    JsonIO.write('local/fluid_tags.json', {
        tag_to_fluids: fluids.tagToEntries,
        fluid_to_tags: fluids.entryToTags
    })
})