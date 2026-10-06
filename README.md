# ArcaWMS — MTG Chaos-Sorting Warehouse System

A minimalist, high-speed personal Warehouse Management System (WMS) engineered specifically for physical Magic: The Gathering (MTG) collections organized via chaos sorting.

---

## ⚡ The Philosophy: Extreme Simplicity

Physical Magic workflows involve messy decks, brewing trays, trade binders, and desleeved piles. **ArcaWMS does not try to model that digital overhead.** 

The software only tracks what actually matters:
1. **In Chaos Drawers**: The card is resting in physical coordinate `[UNIT].[DRAWER].[BATCH]` (e.g. `3.B.11`).
2. **In Decks / Brewing**: The card is checked out of the drawers and is actively being used for play or testing.
3. **Removed / Traded**: The card is marked as sold or traded away and removed from your collection.

No entering deck names, no complex return tray management, and no administrative friction.

---

## 🧭 Core Interfaces

### 1. 🔍 Sniper Search & Pull (Point-of-Discovery Checkout)
- **Scryfall Syntax Support**: Full filter expressions such as `cmc:3`, `cmc<=2`, `t:creature`, `c:u`, `o:"draw"`, `id:esper`.
- **Direct Card Actions**: One-tap **`To Brew`**, **`Trade / Sell`**, and coordinate relocation.
- **Instant Undo**: Any pull or trade action is instantly reversible on-page.
- **Reliable Card Art**: Automatically loads official Scryfall card imagery with universal CDN fallback.

### 2. 🗄️ Skeuomorphic Chaos Cabinet & Brewing Shelf
- **Dynamic Units**: Supports any number of physical storage units ($1 \rightarrow N$), with three drawers per unit (A = Left, B = Middle, C = Right) and unlimited batch dividers.
- **Full Card Routing**: Move cards between Chaos Drawers and the diffuse Decks & Brewing pool, relocate drawer batches, or mark cards as sold/traded away.
- **One-Tap Reversible Undo**: Every cabinet card action features an inline toast notification and batch placeholder with immediate `[ UNDO ↺ ]` capability.
- **Decks & Brewing Compartment**: Dedicated storage shelf below the chaos units to inspect diffuse cards pulled for active play.

### 3. ⚡ Pick-Path Runner (Non-Backtracking Mass Pull)
- **Paste & Go**: Paste decklists or wants lists (e.g., `4 Lightning Bolt`, `1 Sol Ring`).
- **3-Tier Continuous Route**: Linear, non-backtracking routing:
  1. **Unit** (1 $\rightarrow$ N)
  2. **Drawer** (A $\rightarrow$ C)
  3. **Batch** (1 $\rightarrow$ 12+)
- **Ergonomic Buttons**:
  - **`[ PULL ]`**: Marks pulled, routes card out to decks with audio feedback.
  - **`[ SKIP ]`**: Non-punitive skip that leaves the card safely in its drawer.

### 4. 📥 Batch Ingest Engine
- **Smart Batch Allocation**: Automatically selects the first available Unit and Drawer with strictly fewer than 12 non-empty batches.
- **Flexible Numeric Batch Editing**: Smooth typing and backspacing with bounds validation.
- **Scanner List Imports**: Fast imports from Delver Lens, ManaBox, and TCGplayer exports (strips foil tags, set codes, and collector numbers automatically).
- **3-Way Routing Workflow**: Ingest New $\rightarrow$ Chaos, New $\rightarrow$ Brewing, or Return from Brewing $\rightarrow$ Chaos.

---

## 🌐 Deploy Your Own (Free 24/7 Cloud Hosting)

ArcaWMS is engineered to run 24/7 on the cloud with real-time WebSocket synchronization across all your devices (desktop, phone, tablet).

### Step 1: Fork the Repository First ⚠️

> **IMPORTANT**: Always **Fork this repository** to your personal GitHub account first before deploying:
> 1. Click the **Fork** button in the top-right corner of this repository on GitHub.
> 2. Create the fork under your personal GitHub profile (e.g. `https://github.com/your-username/arcawms`).
>
> **Why Fork First?**
> Deploying from your own personal fork ensures that any future upstream commits, feature updates, or experimental branches never disrupt your running cloud instance or collection data. Your database remains strictly yours and protected.

### Step 2: Deploy to Render (100% Free via Blueprint)

1. Sign in to your [Render Dashboard](https://dashboard.render.com/) (free tier).
2. Click **New +** $\rightarrow$ **Blueprint**.
3. Connect your GitHub account and select your **forked** repository (`your-username/arcawms`).
4. Render will automatically detect the [`render.yaml`](./render.yaml) file in the root directory:
   - **Service Type**: Web Service (Node.js)
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Health Check**: `/health`
5. Click **Apply**. Within 2–3 minutes, your personal ArcaWMS system will be deployed live online at your unique `https://arcawms-xxxx.onrender.com` URL.

### Step 3: Install as a PWA on Mobile / iPad

1. Open your live Render URL on your iPhone (Safari) or Android (Chrome).
2. Tap **Share** $\rightarrow$ **Add to Home Screen**.
3. ArcaWMS will launch in full-screen standalone mode like a native app, with real-time cross-device sync.

---

## 💾 Data Backups & Resilient Storage

Under **Settings & Preferences** (gear icon in the top corner):
- **Universal CSV Export**: Download a spreadsheet of your entire collection with quantities, market prices, and physical drawer coordinates.
- **JSON Full System Backup**: Export a complete data snapshot containing instances, catalog cards, settings, and activity history.
- **Backwards-Compatible Restore**: The JSON importer automatically normalizes older backup schemas (including backups with 9 hardcoded units or missing keys) without data loss or `undefined` errors.
- **Rolling Auto-Restore Points**: Rolling snapshots are stored in browser storage before any destructive reset or import for immediate rollback.

---

## 🛠️ Local Development

```bash
# Install dependencies
npm install

# Start development server (Frontend + Sync Server)
npm run dev
```

- **Frontend App**: `http://localhost:5173`
- **Sync & Web Server**: `http://localhost:3001`
