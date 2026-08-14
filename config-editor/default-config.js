"use strict";

const C4_DEFAULT_CONFIG_YAML = String.raw`
# C4 config
# Consumables and recipes belong in the consumables folder beside this file.
# Missing or invalid settings use a safe default and print a console warning.

# ____________________ General ____________________

# Print extra details for recipes, games, quality, names, and effects.
# Use this while developing or tuning C4.
debug: false

# ____________________ Devices ____________________
# GRID recipes use a normal crafting grid. They may need a tool.
# STATION recipes use a placed device. Get one with /c4 device <id>.
# A device texture accepts a skin URL or texture value. Blank textures use a plain head.

# These tools stay in the crafting grid during a process.
# Items in materials lose one durability per craft. Custom head tools do not.
tools:
  cutting:
    display_name: "Cutting Tool"
    materials: [WOODEN_SWORD, STONE_SWORD, IRON_SWORD, GOLDEN_SWORD, DIAMOND_SWORD, NETHERITE_SWORD, SHEARS]
  sifter:
    display_name: "Sifter"
    materials: [COPPER_GRATE, EXPOSED_COPPER_GRATE, WEATHERED_COPPER_GRATE, OXIDIZED_COPPER_GRATE,
                WAXED_COPPER_GRATE, WAXED_EXPOSED_COPPER_GRATE, WAXED_WEATHERED_COPPER_GRATE, WAXED_OXIDIZED_COPPER_GRATE]

# Stations handle their processes instead of the crafting grid.
# Hold an oven_top station and right-click a furnace, smoker, blast furnace, or campfire.
# recipe can be shapeless or shaped.
stations:
  mortar_pestle:
    display_name: "Mortar & Pestle"
    texture: "eyJ0ZXh0dXJlcyI6eyJTS0lOIjp7InVybCI6Imh0dHA6Ly90ZXh0dXJlcy5taW5lY3JhZnQubmV0L3RleHR1cmUvMjk4MTZmMDc4Mzc3ZWU5NTI5ODE0MTQ3ZjdmYTg1NTYwY2FjMzliOWIyZGNkYzkyYmUzN2M0ODNkYyJ9fX0="
    processes: [pound, stir]
    recipe:
      shaped:
        pattern:
          - "S S"
          - "SBS"
          - " S "
        keys:
          S: STONE
          B: BOWL
  cooktop:
    display_name: "Cooktop"
    # 'texture' is used for the four heads embedded into the plate (blank = plain heads).
    texture: "eyJ0ZXh0dXJlcyI6eyJTS0lOIjp7InVybCI6Imh0dHA6Ly90ZXh0dXJlcy5taW5lY3JhZnQubmV0L3RleHR1cmUvZTY2NWZhZmQxZmVkOGU5ZmUzNWFiNTYwZjBiNTYwM2ZjNWVjNDg3YzIxOThjZTM5YmQ1NGM2MjJjNGI3OTllMSJ9fX0="
    oven_top: true
    # A plate station: installed on a furnace/smoker/blast furnace, it places this
    # block on top and embeds four textured heads into it (crop-style displays).
    block: HEAVY_WEIGHTED_PRESSURE_PLATE
    processes: [fry, temperature]
    recipe:
      shaped:
        pattern:
          - "IPI"
          - "SSS"
        keys:
          I: IRON_INGOT
          P: HEAVY_WEIGHTED_PRESSURE_PLATE
          S: SMOOTH_STONE
  # The still and crock are not finished. Get them with /c4 device for testing.
  # Survival recipes, visuals, and sounds are still planned.
  still:
    display_name: "Copper Still"
    texture: "eyJ0ZXh0dXJlcyI6eyJTS0lOIjp7InVybCI6Imh0dHA6Ly90ZXh0dXJlcy5taW5lY3JhZnQubmV0L3RleHR1cmUvOGUwMDlkOGJhN2M0ZGI3Yzk3ZTcwOGYxMDUzNzBjOGIwNDM2M2ZiNTJjMjIwMzljNWU1ZTVmZGE5YzQzMjQ1ZSJ9fX0="
    processes: [distill]
  crock:
    display_name: "Fermentation Jar"
    texture: "eyJ0ZXh0dXJlcyI6eyJTS0lOIjp7InVybCI6Imh0dHA6Ly90ZXh0dXJlcy5taW5lY3JhZnQubmV0L3RleHR1cmUvY2FkMTA1OTJiMjExY2Q2MjU0MDNlODliMGEyNDRjNjczZTdkNDQyOWU1ZGY4NzhjY2I3MmE1MDgwYTZlNDY4ZSJ9fX0="
    processes: [ferment]

# Tools for processes that use a crafting grid.
# Remove a process or use tool: none when it needs no tool.
routing:
  cut:
    tool: cutting
  sieve:
    tool: sifter
  sequence:
    tool: none

# ____________________ Quality ____________________

# Preparation scores run from 0.0 to 1.0.
# Scores below poor ruin the batch and replace it with ruined_item.
quality:
  # Minimum score for each tier; must be strictly increasing, all 0.0-1.0.
  thresholds:
    poor: 0.25
    decent: 0.50
    good: 0.75
    perfect: 0.92
  # Effect-duration multipliers per tier (0.0 or higher).
  multipliers:
    poor: 0.6
    decent: 0.85
    good: 1.0
    perfect: 1.25
  # The junk item handed out for a ruined batch.
  ruined_item:
    material: LEAF_LITTER
    name: "Ruined Mess"
    lore: "The preparation went horribly wrong."
  # What consuming each tier does to you, beyond shorter effect durations.
  # Sloppy batches are dirtier: more addictive and outright harmful.
  consumption:
    poor:
      addiction_multiplier: 1.5
      side_effects:
        - type: nausea
          duration: 200
          amplifier: 0
          chance: 0.5
        - damage: 2.0        # impurities - half a heart, sometimes
          chance: 0.25
    decent:
      addiction_multiplier: 1.15

# ____________________ Insanity ____________________

# Insanity runs from 0 to 100. Dirty doses and withdrawal raise it.
# Clean food has little effect. Poor addictive food has the strongest effect.
# Insanity falls when nothing feeds it. Quality never reduces addictiveness.
insanity:
  decay_per_check: 1.0     # drained every 5s when nothing feeds it
  dose_factor: 35
  craving_gain: 0.5
  withdrawal_gain: 2.0
  damage_gain: 5.0

# ____________________ mcMMO ____________________

# Optional mcMMO support. This only runs when mcMMO is installed.
# Custom crops grant Herbalism XP and roll mcMMO-style double drops on harvest;
# custom foods that set 'mcmmo.diet' benefit from Farmer's/Fisherman's Diet.
mcmmo:
  enabled: true                      # master switch for the integration
  default_herbalism_xp: 50           # XP per harvest for crops that don't set their own
  herbalism_double_drop_chance: 1.0  # max double-drop chance, reached at Herbalism level 1000

# ____________________ Land protection ____________________

# Optional land-claim support. This only runs when a supported plugin is
# installed. C4 crops are display entities and C4 stations are custom heads, so
# they never fire the block events these plugins normally guard - C4 asks them
# directly instead, at the same block location.
#
# With more than one provider installed, an action needs every one of them to
# allow it, and only the first to object explains why.
land-protection:
  enabled: true            # master switch for every provider below
  factionsuuid:
    enabled: true          # honour FactionsUUID territory permissions
  townclaim:
    enabled: true          # honour TownClaim town, plot, and nation permissions

# ____________________ Visuals ____________________

# Visual identity for crafted items and processes.
visuals:
  glint: true        # enchantment shimmer on all crafted items
  particles: true    # crafting ambience, consumption burst, withdrawal/toxic smoke

# ____________________ Crop highlight ____________________

# The wireframe shown when a player looks at a custom crop: the hitbox box is drawn
# as 12 thin bars (edges only, no interior). 'block' is the bar block, 'thickness'
# is the bar width in blocks (0.001-0.5). 'glow' toggles the glowing outline (see
# through walls); with it off the bars are just the plain block. 'glow_color' is a
# name (BLACK, WHITE, RED, GREEN, BLUE, YELLOW, AQUA, ORANGE, PURPLE) or #RRGGBB.
crop_highlight:
  block: BLACK_STAINED_GLASS
  thickness: 0.001
  glow: false
  glow_color: BLACK

# ____________________ Vanilla food spoilage ____________________

# Vanilla food values
# For calibrating a custom consumable's 'food: nutrition / saturation' against
# vanilla (saturation = nutrition x modifier x 2):
#   cookie 2 / 0.4        melon slice 2 / 1.2      raw cod 2 / 0.4
#   apple 4 / 2.4         bread 5 / 6.0            baked potato 5 / 6.0
#   cooked cod 5 / 6.0    cooked chicken 6 / 7.2   cooked salmon 6 / 9.6
#   golden carrot 6 / 14.4   steak 8 / 12.8        rabbit stew 10 / 12.0

# Plain vanilla foods spoil 'lifetime_minutes' after entering an inventory from
# the world or crafting. A value of 0 (or an unlisted food) means never spoils.
# Spoiled food keeps its slot but gives little nutrition and a bout of sickness.
# Missing section = built-in defaults.
#
# The scale is roughly real-time and forgiving: RAW FISH IS THE REFERENCE and
# lasts one real week. Handy values: 1 day = 1440, 4 days = 5760,
# 1 week = 10080, 2 weeks = 20160, 3 weeks = 30240, 1 month = 43200.
vanilla_foods:
  default_lifetime_minutes: 10080  # unlisted-but-tracked foods: 1 week
  items:
    # Raw meat and fish
    BEEF: 14400            # 10 days
    PORKCHOP: 14400
    MUTTON: 14400
    CHICKEN: 10080         # 1 week, spoils like raw fish
    RABBIT: 10080
    COD: 10080             # the reference: raw fish lasts one real week
    SALMON: 10080
    TROPICAL_FISH: 5760    # 4 days
    PUFFERFISH: 5760
    # Cooked meat and fish keep noticeably longer
    COOKED_BEEF: 30240     # 3 weeks
    COOKED_PORKCHOP: 30240
    COOKED_MUTTON: 30240
    COOKED_CHICKEN: 20160  # 2 weeks
    COOKED_RABBIT: 20160
    COOKED_COD: 20160
    COOKED_SALMON: 20160
    # Produce
    APPLE: 43200           # 1 month
    CARROT: 30240          # 3 weeks
    POTATO: 30240
    BEETROOT: 30240
    POISONOUS_POTATO: 30240
    MELON_SLICE: 5760      # 4 days, cut fruit
    GLOW_BERRIES: 5760
    SWEET_BERRIES: 4320    # 3 days
    # Baked goods and dry pantry
    BREAD: 10080           # 1 week
    BAKED_POTATO: 10080
    WHEAT: 43200           # 1 month, dry goods keep
    COOKIE: 43200
    # Prepared meals spoil like leftovers
    MUSHROOM_STEW: 4320    # 3 days
    RABBIT_STEW: 4320
    BEETROOT_SOUP: 4320
    SUSPICIOUS_STEW: 4320
    PUMPKIN_PIE: 4320
    # Preserved/magical foods never spoil (0):
    GOLDEN_APPLE: 0
    ENCHANTED_GOLDEN_APPLE: 0
    GOLDEN_CARROT: 0
    HONEY_BOTTLE: 0
    DRIED_KELP: 0
    ROTTEN_FLESH: 0
    SPIDER_EYE: 0
    CHORUS_FRUIT: 0

# ____________________ Consumable groups ____________________

# Recipe groups can contain materials, consumable ids, or other groups.
# Use tag: <name> in a recipe to accept any member.
consumable_groups:
  fruit: [
    APPLE,
    SWEET_BERRIES,
    GLOW_BERRIES,
    MELON_SLICE,
  ]
  dairy: [
    MILK_BUCKET,
  ]
  # 'baskets' nests other groups.
  baskets: [
    fruit,
    dairy,
  ]

# ____________________ Biome groups ____________________

# Biome groups can contain biome ids or other groups.
# Crops may use a group name anywhere they can use a biome id.
# Unknown names print a warning and are skipped.
biome_groups:
  # Temperate lowland
  plains_like: [
    plains,
    sunflower_plains,
    meadow,
  ]
  forest_like: [
    forest,
    flower_forest,
    birch_forest,
    old_growth_birch_forest,
  ]
  # Heavy canopy. Good for crops that like shade, such as tobacco.
  deep_forest: [
    dark_forest,
    pale_garden,
  ]
  cherry: [
    cherry_grove,
  ]
  # Cold
  taiga_like: [
    taiga,
    snowy_taiga,
    old_growth_pine_taiga,
    old_growth_spruce_taiga,
    grove,
  ]
  # Frozen ground for hardy crops such as cabbage and beetroot.
  snowy: [
    snowy_plains,
    ice_spikes,
    snowy_beach,
    snowy_taiga,
    frozen_river,
  ]
  # Hot and dry
  savanna_like: [
    savanna,
    savanna_plateau,
    windswept_savanna,
  ]
  badlands_like: [
    badlands,
    eroded_badlands,
    wooded_badlands,
  ]
  # 'arid' nests badlands_like alongside the desert.
  arid: [
    desert,
    badlands_like,
  ]
  # Tropical
  jungle_like: [
    jungle,
    sparse_jungle,
    bamboo_jungle,
  ]
  # 'tropical' nests another group (jungle_like) alongside a biome.
  tropical: [
    jungle_like,
    savanna,
  ]
  # Wet
  wetlands: [
    swamp,
    mangrove_swamp,
  ]
  # Fresh water margins and shorelines.
  waterside: [
    river,
    frozen_river,
    beach,
    snowy_beach,
    stony_shore,
  ]
  # Exposed and rocky. Best for hardy cereals.
  windswept: [
    windswept_hills,
    windswept_gravelly_hills,
    windswept_forest,
  ]
  # Special
  mushroom: [
    mushroom_fields,
  ]
  nether: [
    nether_wastes,
    crimson_forest,
    warped_forest,
    soul_sand_valley,
    basalt_deltas,
  ]
  oceans: [
    ocean,
    deep_ocean,
    cold_ocean,
    deep_cold_ocean,
    lukewarm_ocean,
    deep_lukewarm_ocean,
    warm_ocean,
    frozen_ocean,
    deep_frozen_ocean,
  ]

# ____________________ Grass seeds ____________________

# C4 can replace the normal wheat seed drop from grass and small plants.
# First, drop_chance decides whether any seed drops. The default is 0.125.
# Next, the eligible seeds for that biome share a weighted pick.
# A weight of 0.3 is three times as likely as 0.1. A weight of 0 removes the seed.
# Fortune increases the amount, but not the chance. Shears never drop a seed.
# Only wheat, beetroot, melon, and pumpkin have separate vanilla seed items.
grass_seeds:
  enabled: true
  drop_chance: 0.125
  vanilla_weight: 0.125

# ____________________ Vanilla crops ____________________

# Vanilla crops grow at full speed in their natural biomes.
# outside_rate controls growth elsewhere. Bonemeal ignores this limit.
# A biomes list can use biome ids or biome group names.
vanilla_crops:
  default_outside_rate: 0.5
  crops:
    # A temperate grassland cereal - the open, grassy biomes.
    WHEAT: {
      biomes: [
        plains_like,
        savanna_like,
      ],
      outside_rate: 0.5
    }
    # Cool temperate root - open ground and forest clearings.
    CARROTS: {
      biomes: [
        plains_like,
        forest_like,
      ],
      outside_rate: 0.5
    }
    # Andean highland tuber - cool, poor, rocky soil.
    POTATOES: {
      biomes: [
        plains_like,
        taiga_like,
        windswept,
      ],
      outside_rate: 0.5
    }
    # The most cold-hardy vanilla root - the only one that likes frozen ground.
    BEETROOTS: {
      biomes: [
        plains_like,
        snowy,
        taiga_like,
      ],
      outside_rate: 0.5
    }
    MELON: {
      biomes: [
        tropical,
      ],
      outside_rate: 0.6
    }
    MELON_STEM: {
      biomes: [
        tropical,
      ],
      outside_rate: 0.6
    }
    # Pumpkins are temperate, not tropical - they follow the vine into the
    # forests and cool grassland rather than the jungle.
    PUMPKIN: {
      biomes: [
        plains_like,
        forest_like,
        taiga_like,
      ],
      outside_rate: 0.6
    }
    PUMPKIN_STEM: {
      biomes: [
        plains_like,
        forest_like,
        taiga_like,
      ],
      outside_rate: 0.6
    }
    COCOA: {
      biomes: [
        jungle_like,
      ],
      outside_rate: 0.5
    }
    SWEET_BERRY_BUSH: {
      biomes: [
        taiga_like,
      ],
      outside_rate: 0.5
    }
    NETHER_WART: {
      biomes: [
        nether,
      ],
      outside_rate: 0.7
    }
    # A wet-margin tropical grass - swamps, jungle and the water's edge.
    SUGAR_CANE: {
      biomes: [
        wetlands,
        jungle_like,
        waterside,
      ],
      outside_rate: 0.6
    }
    CACTUS: {
      biomes: [
        arid,
      ],
      outside_rate: 0.4
    }
    BAMBOO: {
      biomes: [
        jungle_like,
      ],
      outside_rate: 0.4
    }
    KELP: {
      biomes: [
        oceans,
      ],
      outside_rate: 0.6
    }
    # Swamp flowers, dug from suspicious sand/gravel - they belong to the
    # wetlands and the archaeology biomes they are found in.
    TORCHFLOWER_CROP: {
      biomes: [
        plains_like,
        savanna_like,
      ],
      outside_rate: 0.5
    }
    PITCHER_CROP: {
      biomes: [
        wetlands,
        waterside,
      ],
      outside_rate: 0.5
    }

# ____________________ Bug reports and feedback ____________________
# Players use /c4 report bug <text> or /c4 report feedback <text>.
# The report URL and token are added when the JAR is built.
# The GitHub token stays in AWS. Failed reports go to failed-reports.jsonl.
reports:
  enabled: true       # master on/off; also implicitly off if the jar lacks a baked-in endpoint
  min-length: 10      # minimum characters of report text before it is accepted
  max-length: 2000    # maximum characters; longer reports are rejected (GitHub caps bodies at 65536)
  max-per-window: 3   # reports a player may submit within the rolling window
  window-minutes: 60
`;
