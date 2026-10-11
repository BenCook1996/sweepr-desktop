---
name: package-sweepr
description: Build and package the Sweepr desktop app into a standalone Windows installer.
---

# Packaging Sweepr

To package the Sweepr app for distribution:

1. Ensure the Rust toolchain and Node are installed.
2. Navigate to the `app` directory:
   ```bash
   cd app
   ```
3. Run the Tauri build command:
   ```bash
   npm.cmd run app:build
   ```
4. The generated installer will be located in `app/src-tauri/target/release/bundle/nsis/`.

Remember to check `app/.env` before packaging to ensure `SWEEPR_DEV_UNLOCK=1` is removed for production builds so that the Stripe integration is strictly enforced!
