# ArcaWMS — MTG Chaos-Sorting Warehouse System

A minimalist, high-speed personal Warehouse Management System (WMS) engineered specifically for physical Magic: The Gathering (MTG) collections organized via chaos sorting.

---

## ⚡ The Philosophy: Extreme Simplicity

Physical Magic workflows involve messy decks, brewing trays, trade binders, and desleeved piles. **ArcaWMS does not try to model that digital overhead.** 

The software only tracks what actually matters:
1. **In Chaos Drawers**: The card is resting in physical coordinate `[UNIT].[DRAWER].[BATCH]` (e.g. `3.B.11`).
2. **In Decks / Brewing**: The card is checked out of the drawers and is actively being used.
3. **Removed / Traded**: The card is no longer in your collection.

No entering deck names, no complex return tray management, and no extra administrative friction.

---

## 🧭 3 Core Interfaces

### 1. 🔍 Search & Pull (Point-of-Discovery Checkout)
- **Scryfall Syntax Support**: Full filter expressions such as `cmc:3`, `cmc<=2`, `t:creature`, `c:u`, `o:"draw"`, `id:esper`.
- **Instant Checkout**: One-tap **`[ Check Out ]`** button beside the physical coordinate. Instantly marks the card as checked out into brewing/decks.
- **Return to Drawers**: One-tap **`[ Return to Chaos ]`** button to reassign back to a drawer coordinate.
- **Reliable Card Art**: Automatically loads official Scryfall card imagery with universal CDN fallback.

### 2. ⚡ Pick-Path Runner (Non-Backtracking Mass Pull)
- **Paste & Go**: Paste decklists or wants lists (e.g., `4 Lightning Bolt`, `1 Sol Ring`).
- **3-Tier Continuous Route**:
  1. **Unit** (1 $\rightarrow$ 9)
  2. **Drawer** (A $\rightarrow$ C)
  3. **Batch** (1 $\rightarrow$ 12+)
- **Ergonomic Buttons**:
  - **`[ PULL ]`**: Marks pulled, checks card out to decks with audio feedback.
  - **`[ SKIP ]`**: Non-punitive skip that leaves the card safely in its drawer.

### 3. 📥 Batch Ingest
- **Target Drawer Coordinate**: Select `[Unit].[Drawer].[Batch]` (e.g. `4.C.02`) with a fast `Next Batch (+1)` button.
- **Pasted Scanner Lists**: Import cards directly from scanner apps (Delver Lens, ManaBox, TCGplayer).
- **Return from Brews**: One-tap batch re-filing of pulled cards back into active drawer slots.

---

## 🚀 Running ArcaWMS

```bash
npm run dev
```

- **Desktop**: `http://localhost:5173`
- **Mobile / iPad on same Wi-Fi**: `http://<your-local-ip>:5173`
- **Real-Time Sync Server**: `http://localhost:3001` (sub-second WebSocket sync across all devices)
