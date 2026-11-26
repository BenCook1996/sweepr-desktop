cask "sweepr-cleaner" do
  version "0.1.0"
  sha256 "d13a23aaca6b2aee1bc2e5602f792c31d0cefa147121686944fedec66b17ae6a"

  url "https://sweeprcleaner.com/SWEEPRCleaner.dmg"
  name "SWEEPR Cleaner"
  desc "Native Rust PC & Mac storage cleaner with 7-Day Undo Quarantine"
  homepage "https://sweeprcleaner.com/"

  livecheck do
    url "https://sweeprcleaner.com/release-manifest.json"
    strategy :json do |json|
      json["version"]
    end
  end

  depends_on macos: ">= :big_sur"

  app "SWEEPRCleaner.app"

  zap trash: [
    "~/Library/Application Support/com.sweepr.cleaner",
    "~/Library/Caches/com.sweepr.cleaner",
    "~/Library/LaunchAgents/com.sweepr.cleaner.scheduled-clean.plist",
    "~/Library/Preferences/com.sweepr.cleaner.plist",
    "~/Library/Saved Application State/com.sweepr.cleaner.savedState",
  ]
end
