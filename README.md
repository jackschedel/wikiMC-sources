<h1 align="center"><b>wikiMC Sources</b></h1>

<p align="center">
    <a href="https://wiki.koaladev.io" target="_blank"><img src="https://wikiMC.org/favicon.png" alt="wikiMC.org icon" width="100" /></a>
</p>

<h4 align="center"><b>This is the public sources repository for https://wikiMC.org</b></h4>

<p align="center">
<a href="https://github.com/jackschedel/wikiMC-sources/issues" target="_blank">
    <img src="https://img.shields.io/github/issues/jackschedel/wikiMC-sources?style=flat-square" alt="issues"/>
</a>

<a href="https://github.com/jackschedel/wikiMC-sources/pulls" target="_blank">
    <img src="https://img.shields.io/github/issues-pr/jackschedel/wikiMC-sources?style=flat-square" alt="pull-requests"/>
</a>

</p>

## Repository Contents

Currently, this repository is composed of three things:

- **`quest-sources.config.mjs`** - Defines where to find the FTB Quests files for each modpack in the wiki.
- **`item_icons/`** - Contains the preview PNGs for every block and item in every modpack on the wiki.
- **`modpack_data/`** - Contains a single JSON file per modpack (e.g., `Monifactory.json`) holding the exported item names, recipe data, item/fluid tags, NBT-dependent names, and item tooltips/descriptions.

The `item_icons` folder includes the item icon for **every** item in the pack, not just the ones with recipes or in the quest book. My hope is that these can be useful in the future, either for future wiki features, or just as a repository for other developers.

## Issues

Please create issues on this repo for any bugs/feature requests for [wikiMC.org](https://wikiMC.org) as a whole, even though this repository is just for the sources.

## Adding a New Modpack

### 1. Configure Quest Sources

Add a new array element in `quest-sources.config.mjs` for the new modpack, following the format:

```js
{
  slug: "GregTech-Modern-Community-Pack",
  repo: "GregTechCEu/GregTech-Modern-Community-Pack",
  branch: "main",
  title: "GregTech Community Pack Modern",
  questsPaths: ["config/ftbquests/quests"],
  langDirs: ["kubejs/assets/gtceu/lang"],
},
```

### 2. Export Item Icons

Run the modpack locally on your computer, using a mod to export all block and item previews. For Forge 1.20.1, I recommend [BlockExporter](https://github.com/jackschedel/blockexporter-1.20.1/releases/tag/1.20.1-forge-v2) — I personally made this 1.20.1 Forge release version specifically for this wiki project. This will automatically use the correct filename standard.

Requirements:
- **Format:** PNG
- **Resolution:** 256×256
- **Filename:** Same as item id in game, replacing `:` with `_`.

Add the exported icons to the `item_icons/` folder in the repository.

> [!NOTE]
> All fluids appear in a subfolder `fluids`, because their ids are not unique with items ids. Any item icons with `/` in the Minecraft item ID will appear in a subfolder. Because this folder is not per-modpack, it is possible that there will be conflicts between items/blocks of the same name (either for different versions of the mod or for something generic like `kubejs:coin`). If this becomes an issue, I can add support for per-modpack image overrides as well.

### 3. Export Item and Recipe Data

Both export scripts write into the same file, `.minecraft/local/modpack_data.json`. Since the server and client scripts run separately, each one merges its keys into the file without overwriting the other's data.

1. Copy `SERVER_export_modpack_data.js` from the respository to your modpack instance's `.minecraft/kubejs/server_scripts` folder. Load a singleplayer world.
2. Copy `CLIENT_export_modpack_data.js` from the respository to your modpack instance's `.minecraft/kubejs/client_scripts` folder. **With the world still loaded, open the creative inventory once** (so the creative search tab is populated), **then run** `/kubejs reload client_scripts`, **holding Shift while pressing enter**.
   - Many mods hide the useful part of an item's tooltip behind a held key (e.g. GregTech coils: *"Hold SHIFT to show Coil Bonus Info"*). This content is only generated while the key is physically down, so to capture it, **hold `Shift` while pressing Enter to submit the reload command**.

Add the resulting `.minecraft/local/modpack_data.json` file to the `modpack_data/` folder in the repository, naming it `{modpack name}.json`.

### 4. Create a Pull Request

Submit a Pull Request with your changes.

## Disclaimer

I do not own the rights to any modpack quest content. I do not own the rights to any block or item image previews from Minecraft or from any mods.
