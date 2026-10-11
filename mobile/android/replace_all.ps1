$xml = [xml](Get-Content "app/src/main/res/values/strings.xml" -Raw)
$strings = @{}

foreach ($node in $xml.resources.string) {
    if ($node.name -and $node.InnerText) {
        # Only map literal strings for replacement. No plurals needed since they are already covered.
        $text = $node.InnerText.Replace('\"', '"').Replace("\'", "'").Replace('\n', "`n")
        $strings[$text] = "R.string." + $node.name
    }
}

$files = Get-ChildItem -Path "app/src/main/java/com/sweepr/app" -Filter "*.kt" -Recurse | Where-Object { 
    $_.Name -match "Screen" -or $_.Name -match "Common" -or $_.Name -match "Account" 
}

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $hasChanges = $false
    
    $keys = $strings.Keys | Sort-Object { $_.Length } -Descending
    foreach ($k in $keys) {
        $escaped_k = $k.Replace('"', '\"')
        $literal = '"' + $escaped_k + '"'
        if ($content.Contains($literal)) {
            $res = $strings[$k]
            $content = $content.Replace($literal, "stringResource($res)")
            $hasChanges = $true
        }
    }
    
    if ($hasChanges) {
        if (-not $content.Contains("import androidx.compose.ui.res.stringResource")) {
            $content = $content -replace "(import androidx.compose.[^\r\n]+)", "`$1`r`nimport androidx.compose.ui.res.stringResource"
        }
        Set-Content $file.FullName $content -NoNewline
        Write-Host "Updated $($file.Name)"
    }
}
