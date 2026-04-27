# detectMeetings.ps1
# This script uses Windows UI Automation to find Microsoft Teams meeting windows.
# It returns a JSON array of window titles.

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [Windows.Automation.AutomationElement]::RootElement
# Optimization: Only look for top-level windows first
$winCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Window)
$windows = $root.FindAll([Windows.Automation.TreeScope]::Children, $winCondition)

$results = @()

foreach ($win in $windows) {
    $name = $win.Current.Name
    # Preliminary filter: Window title must contain "Teams" and not be "Chat" or "Calendar"
    if ($name -like "*Teams*" -and $name -notlike "Chat |*" -and $name -notlike "Calendar |*") {
        
        # Check for meeting-specific controls (indicators)
        # We search for buttons that only appear in meetings
        $btnCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button)
        $buttons = $win.FindAll([Windows.Automation.TreeScope]::Descendants, $btnCondition)
        
        $isMeeting = $false
        foreach ($btn in $buttons) {
            $btnName = $btn.Current.Name
            # Indicators: Mute, Camera, Hang Up, Leave, Share (Simplified for encoding safety)
            if ($btnName -match "Mute|Mudo|Microfone|Hang up|Sair|Leave|mera|Camera|partilhar|Share") {
                $isMeeting = $true
                break
            }
        }
        
        if ($isMeeting) {
            $results += $name
        }
    }
}

if ($results.Count -eq 0) {
    Write-Output "[]"
} else {
    $results | ConvertTo-Json
}
