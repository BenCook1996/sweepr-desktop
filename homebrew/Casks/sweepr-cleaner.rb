cask "sweepr-cleaner" do
  version "0.1.0"
  sha256 "88f3df54147b629afbc636274b215871871c8bb510bffcc7095956e790ebe952"

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
