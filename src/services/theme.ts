export type GuildThemeId = 
  | 'orzhov'
  | 'azorius'
  | 'dimir'
  | 'rakdos'
  | 'gruul'
  | 'selesnya'
  | 'izzet'
  | 'golgari'
  | 'boros'
  | 'simic';

export interface GuildTheme {
  id: GuildThemeId;
  name: string;
  colors: string; // MTG colors, e.g. "White / Blue"
  guild: string;
  primaryHex: string;
  accentHex: string;
  description: string;
}

export const GUILD_THEMES: GuildTheme[] = [
  {
    id: 'orzhov',
    name: 'Orzhov',
    colors: 'White / Black',
    guild: 'W/B',
    primaryHex: '#f59e0b',
    accentHex: '#f1f5f9',
    description: 'Aristocratic gold & obsidian silver'
  },
  {
    id: 'azorius',
    name: 'Azorius',
    colors: 'White / Blue',
    guild: 'W/U',
    primaryHex: '#38bdf8',
    accentHex: '#f8fafc',
    description: 'Senate azure blue & alabaster law'
  },
  {
    id: 'dimir',
    name: 'Dimir',
    colors: 'Blue / Black',
    guild: 'U/B',
    primaryHex: '#06b6d4',
    accentHex: '#818cf8',
    description: 'Shadow cobalt & stealth indigo'
  },
  {
    id: 'rakdos',
    name: 'Rakdos',
    colors: 'Black / Red',
    guild: 'B/R',
    primaryHex: '#f43f5e',
    accentHex: '#fb923c',
    description: 'Carnival crimson & ember flare'
  },
  {
    id: 'gruul',
    name: 'Gruul',
    colors: 'Red / Green',
    guild: 'R/G',
    primaryHex: '#f97316',
    accentHex: '#4ade80',
    description: 'Wild terracotta red & jungle moss'
  },
  {
    id: 'selesnya',
    name: 'Selesnya',
    colors: 'Green / White',
    guild: 'G/W',
    primaryHex: '#10b981',
    accentHex: '#fef08a',
    description: 'Verdant canopy emerald & sunlit dawn'
  },
  {
    id: 'izzet',
    name: 'Izzet',
    colors: 'Blue / Red',
    guild: 'U/R',
    primaryHex: '#00f0ff',
    accentHex: '#f43f5e',
    description: 'Lightning arc cyan & boiler scarlet'
  },
  {
    id: 'golgari',
    name: 'Golgari',
    colors: 'Black / Green',
    guild: 'B/G',
    primaryHex: '#84cc16',
    accentHex: '#10b981',
    description: 'Under-city lichen lime & rot jade'
  },
  {
    id: 'boros',
    name: 'Boros',
    colors: 'Red / White',
    guild: 'R/W',
    primaryHex: '#ef4444',
    accentHex: '#fef08a',
    description: 'Legion flame red & sunburst ivory'
  },
  {
    id: 'simic',
    name: 'Simic',
    colors: 'Green / Blue',
    guild: 'G/U',
    primaryHex: '#14b8a6',
    accentHex: '#38bdf8',
    description: 'Bioluminescent deep teal & seafoam cyan'
  }
];

const THEME_STORAGE_KEY = 'arcawms_guild_theme';

export function getActiveTheme(): GuildThemeId {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as GuildThemeId;
    if (saved && GUILD_THEMES.some(t => t.id === saved)) {
      return saved;
    }
  } catch {}
  return 'orzhov'; // Default warm MTG artifact gold
}

export function applyTheme(themeId: GuildThemeId) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', themeId);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {}
}
