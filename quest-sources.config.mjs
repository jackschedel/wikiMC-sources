export default [
  {
    slug: "Monifactory",
    repo: "ThePansmith/Monifactory",
    branch: "main",
    questsPaths: [
      "config/ftbquests/quests",
      "config-overrides/normal/ftbquests/quests",
    ],
    langDirs: ["kubejs/assets/ftbquests/lang"],
    // Feature toggles enabled in this pack mode, mirroring Monifactory's KubeJS
    // packmode globals (minecraft/kubejs/startup_scripts/_packmode.js, default
    // mode "Normal"). Quests gated behind do<Feature>/dont<Feature> gamestages
    // in the always-invisible dependency_chain chapter resolve against this:
    // a do<Feature> gate is open when the feature is listed, a dont<Feature>
    // gate is open when it is not. Omit to show every gated quest.
    enabledFeatures: [
      "Boilers",
      "Compacting",
      "Converters",
      "EUP2P",
      "Fluxbore",
      "HarderFluxBore",
      "HatchRevert",
      "HNN",
      "LaserIO",
      "Monicoins",
      "Snad",
    ],
  },
  {
    slug: "Monifactory-Hard",
    repo: "ThePansmith/Monifactory",
    branch: "main",
    questsPaths: [
      "config/ftbquests/quests",
      "config-overrides/hardmode/ftbquests/quests",
    ],
    langDirs: ["kubejs/assets/ftbquests/lang"],
    enabledFeatures: [
      "Boilers",
      "Compacting",
      "Converters",
      "Fluxbore",
      "HarderFluxBore",
      "HarderProcessing",
      "HarderRecipes",
      "HatchRevert",
      "HostileMicroverse",
      "LaserIO",
      "MeowniPlush",
      "QuantumCoolant",
      "Snad",
      "SteamAge",
    ],
  },
  {
    slug: "Monifactory-Expert",
    repo: "ThePansmith/Monifactory",
    branch: "main",
    questsPaths: [
      "config/ftbquests/quests",
      "config-overrides/expert/ftbquests/quests",
    ],
    langDirs: ["kubejs/assets/ftbquests/lang"],
    enabledFeatures: [
      "AssemblyLineOrderingWarning",
      "HarderPrintedSilicon",
      "HarderProcessing",
      "HarderRecipes",
      "HostileMicroverse",
      "MeowniPlush",
      "QuantumCoolant",
      "SteamAge",
    ],
  },
  {
    slug: "GregTech-Modern-Community-Pack",
    repo: "GregTechCEu/GregTech-Modern-Community-Pack",
    branch: "main",
    questsPaths: ["config/ftbquests/quests"],
    langDirs: ["kubejs/assets/gtceu/lang"],
  },
];
