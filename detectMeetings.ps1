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
    $processId = $win.Current.ProcessId
    
    # Verify if the process is Microsoft Teams (New or Classic)
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process -and ($process.ProcessName -eq "ms-teams" -or $process.ProcessName -eq "Teams")) {
        
        # Filter out obvious non-meeting windows
        if ($name -like "Chat |*" -or $name -like "Calendar |*" -or $name -eq "Microsoft Teams") {
            continue
        }

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
