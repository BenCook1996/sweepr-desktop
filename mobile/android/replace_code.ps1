$files = @(
    "AppLanguage.kt", "CleanScreen.kt", "Common.kt", "ContactsScanner.kt", 
    "ContactsScreen.kt", "DashboardScreen.kt", "DashboardViewModel.kt", 
    "LogFiles.kt", "MainActivity.kt", "MediaScanner.kt", "MediaScreens.kt", 
    "Prefs.kt", "SettingsScreen.kt", "SwipeCleanupScreen.kt", "TipsScreen.kt"
)

$base = "app/src/main/java/com/sweepr/app"

function Replace-In-File {
    param ($file, $from, $to)
    $path = "$base/$file"
    if (Test-Path $path) {
        $content = Get-Content $path -Raw
        $content = $content.Replace($from, $to)
        Set-Content $path $content -NoNewline
    }
}

# Example replacements:
# MainActivity.kt
Replace-In-File "MainActivity.kt" 'NavTab(Screen.Dashboard, "Home", Icons.Default.Home)' 'NavTab(Screen.Dashboard, R.string.nav_home, Icons.Default.Home)'
Replace-In-File "MainActivity.kt" 'NavTab(Screen.SmartClean, "Clean", Icons.Default.Delete)' 'NavTab(Screen.SmartClean, R.string.nav_clean, Icons.Default.Delete)'
Replace-In-File "MainActivity.kt" 'NavTab(Screen.Tips, "Tips", Icons.Default.Info)' 'NavTab(Screen.Tips, R.string.nav_tips, Icons.Default.Info)'
Replace-In-File "MainActivity.kt" 'NavTab(Screen.Settings, "Settings", Icons.Default.Settings)' 'NavTab(Screen.Settings, R.string.nav_settings, Icons.Default.Settings)'
Replace-In-File "MainActivity.kt" 'val label: String' 'val label: Int'
Replace-In-File "MainActivity.kt" 'Text(tab.label)' 'Text(stringResource(tab.label))'
Replace-In-File "MainActivity.kt" 'import androidx.compose.material3.Text' "import androidx.compose.material3.Text`nimport androidx.compose.ui.res.stringResource"
Replace-In-File "MainActivity.kt" 'class MainActivity : ComponentActivity()' 'class MainActivity : androidx.appcompat.app.AppCompatActivity()'
