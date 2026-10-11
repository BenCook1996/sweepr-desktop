# Sweepr Development Guidelines

You are working on **Sweepr**, a Digital Optimization & Maintenance desktop app targeting general consumers.

## Architecture
- **Frontend**: Svelte 5 + Vite, located in `app/src/`.
- **Backend**: Rust + Tauri 2, located in `app/src-tauri/`.
- **License Server**: Node.js + Hono + SQLite + Stripe, located in `server/`.

## Running the App
- Always use `npm.cmd` instead of `npm` on this Windows machine to avoid execution policy errors.
- To run the desktop app: `cd app` and `npm.cmd run app:dev`
- To run the license server: `cd server` and `npm.cmd run dev` (running on port 8787).
- If you need to test the Pro features locally without a Stripe webhook, ensure `SWEEPR_DEV_UNLOCK=1` is set in the `app/.env` file.

## UI/UX Principles
- **No Confirmation Modals**: Deletions are safe by default and use the OS Trash. Do not add "Are you sure?" dialogs.
- **Micro-interactions**: Primary buttons have a tactile hover scale (`transform: scale(1.02)`) and a green glow. The completion state must feel highly rewarding.
- **Hierarchy**: The "Total Bytes Found" number uses the `.big-number` class (`48px`, `font-weight: 800`) to dominate the visual hierarchy. Do not clutter the results screen with paths unless requested.

## Rust Development (Windows)
- The user's system is using the `stable-x86_64-pc-windows-gnu` Rust toolchain because MSVC failed to install.
- If you encounter `dlltool.exe` missing errors, you must remind the user to install the Microsoft Visual C++ Build Tools and switch back to `msvc`.
