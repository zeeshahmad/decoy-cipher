export interface Theme {
  id: string;
  name: string;
  emoji: string;
  /** The text the model "continues". Changing this breaks old messages, so never edit; add a new id. */
  prompt: string;
}

export const THEMES: Theme[] = [
  {
    id: "pirate",
    name: "Pirate's log",
    emoji: "🏴‍☠️",
    prompt: "Captain's log of the pirate ship Salty Gull. The sea was rough today, and",
  },
  {
    id: "weather",
    name: "Weather report",
    emoji: "⛅",
    prompt: "Good evening and welcome to the regional weather report. Tonight across the valley,",
  },
  {
    id: "recipe",
    name: "Cooking blog",
    emoji: "🍲",
    prompt: "Welcome back to my kitchen! Today I am sharing my grandmother's favorite soup, and",
  },
  {
    id: "scifi",
    name: "Starship log",
    emoji: "🚀",
    prompt: "Stardate 4172.3. Captain's log. The starship Meridian has entered the nebula, and",
  },
  {
    id: "tavern",
    name: "Fantasy tavern tale",
    emoji: "🍺",
    prompt: "The old innkeeper leaned across the bar and began his tale of the dragon in the mountains.",
  },
  {
    id: "review",
    name: "Product review",
    emoji: "⭐",
    prompt: "Five stars. I bought this blender last month and honestly,",
  },
  {
    id: "diary",
    name: "Cozy diary",
    emoji: "📔",
    prompt: "Dear diary, today was a quiet day at the lake house, and",
  },
];

export const themeById = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];
