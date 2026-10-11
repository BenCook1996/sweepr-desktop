import SwiftUI

struct ContentView: View {
    @State private var hasProAccess = false

    var body: some View {
        Group {
            if hasProAccess {
                Text("Sweepr Pro Dashboard")
            } else {
                Text("Free Dashboard")
            }
        }
        .task {
            // Verify RevenueCat status on launch
            // hasProAccess = await RevenueCatService.checkPro()
        }
    }
}
