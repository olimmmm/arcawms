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
  colors: string; // MTG colors, e.g. "White / Black"
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
    primaryHex: '#ffffff',
    accentHex: '#f59e0b',
    description: 'Syndicate stark marble white & gilded coin gold'
  },
  {
    id: 'azorius',
    name: 'Azorius',
    colors: 'White / Blue',
    guild: 'W/U',
    primaryHex: '#38bdf8',
    accentHex: '#f8fafc',
    description: 'Senate azure blue & alabaster silver'
  },
  {
    id: 'dimir',
    name: 'Dimir',
    colors: 'Blue / Black',
    guild: 'U/B',
    primaryHex: '#06b6d4',
    accentHex: '#818cf8',
    description: 'Shadow cobalt cyan & stealth violet indigo'
  },
  {
    id: 'rakdos',
    name: 'Rakdos',
    colors: 'Black / Red',
    guild: 'B/R',
    primaryHex: '#ef4444',
    accentHex: '#f97316',
    description: 'Carnival flame red & bonfire orange'
  },
  {
    id: 'gruul',
    name: 'Gruul',
    colors: 'Red / Green',
    guild: 'R/G',
    primaryHex: '#f97316',
    accentHex: '#22c55e',
    description: 'Wild terracotta red & jungle moss green'
  },
  {
    id: 'selesnya',
    name: 'Selesnya',
    colors: 'Green / White',
    guild: 'G/W',
    primaryHex: '#10b981',
    accentHex: '#fef08a',
    description: 'Verdant canopy emerald & sunlit dawn ivory'
  },
  {
    id: 'izzet',
    name: 'Izzet',
    colors: 'Blue / Red',
    guild: 'U/R',
    primaryHex: '#0284c7',
    accentHex: '#ef4444',
    description: 'Lightning arc blue & boiler scarlet red'
  },
  {
    id: 'golgari',
    name: 'Golgari',
    colors: 'Black / Green',
    guild: 'B/G',
    primaryHex: '#22c55e',
    accentHex: '#eab308',
    description: 'Under-city rot green & necrotic spore amber'
  },
  {
    id: 'boros',
    name: 'Boros',
    colors: 'Red / White',
    guild: 'R/W',
    primaryHex: '#ef4444',
    accentHex: '#f8fafc',
    description: 'Legion flame red & sunburst ivory white'
  },
  {
    id: 'simic',
    name: 'Simic',
    colors: 'Green / Blue',
    guild: 'G/U',
    primaryHex: '#10b981',
    accentHex: '#06b6d4',
    description: 'Bioluminescent deep green & seafoam marine blue'
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
  return 'orzhov'; // Default crisp MTG White & Black
}

export function applyTheme(themeId: GuildThemeId) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', themeId);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {}
}
