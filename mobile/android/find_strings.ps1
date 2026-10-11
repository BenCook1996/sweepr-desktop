$xml = [xml](Get-Content "app/src/main/res/values/strings.xml" -Raw)
$strings = @{}

foreach ($node in $xml.resources.string) {
    if ($node.name -and $node.InnerText) {
        $text = $node.InnerText.Replace('\"', '"').Replace("\'", "'").Replace('\n', "`n")
        $strings[$text] = "R.string." + $node.name
    }
}

foreach ($node in $xml.resources.plurals) {
    if ($node.name) {
        foreach ($item in $node.item) {
            $q = $item.quantity
            if ($item.InnerText) {
                $text = $item.InnerText.Replace('\"', '"').Replace("\'", "'").Replace('\n', "`n")
                $strings[$text] = "R.plurals." + $node.name
            }
        }
    }
}

Write-Host "Loaded $($strings.Count) string resources"

# We will just print occurrences to check them
Get-ChildItem -Path "app/src/main/java/com/sweepr/app" -Filter "*.kt" -Recurse | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    $found = $false
    
    $matches = [regex]::Matches($content, '"([^"]*)"')
    foreach ($m in $matches) {
        $val = $m.Groups[1].Value
        $val_unesc = $val.Replace('\"', '"').Replace("\'", "'")
        
        if ($strings.ContainsKey($val_unesc)) {
            if (-not $found) {
                Write-Host "`n--- $($_.Name) ---"
                $found = $true
            }
            Write-Host "Found '$val' -> $($strings[$val_unesc])"
        }
    }
}
