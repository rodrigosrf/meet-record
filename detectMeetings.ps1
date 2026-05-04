# detectMeetings.ps1
# This script uses Windows UI Automation to find Microsoft Teams meeting windows.
# Optimized for performance and reliability.

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# Set output encoding to UTF8 to avoid issues with special characters
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = [Windows.Automation.AutomationElement]::RootElement
# Only look for top-level windows
$winCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Window)
$windows = $root.FindAll([Windows.Automation.TreeScope]::Children, $winCondition)

$results = @()

foreach ($win in $windows) {
    try {
        $name = $win.Current.Name
        $processId = $win.Current.ProcessId
        
        # Verify if the process is Microsoft Teams
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($process -and ($process.ProcessName -match "ms-teams|Teams")) {
            
            $isMeeting = $false
            
            # 1. Check if the window title suggests a meeting (highly likely)
            if ($name -match "Reunião|Meeting|Call|Chamada|Conferência") {
                $isMeeting = $true
            }

            # If not identified by title, check if we should exclude it or do a deep check
            if (-not $isMeeting) {
                # Filter out known non-meeting windows early
                if ($name -match "Chat \||Calendar \||Microsoft Teams|Notificações|Notifications") {
                    continue
                }
            }

            # 2. Deep check only if not already confirmed
            if (-not $isMeeting) {
                # Look for buttons that are unique to meeting windows
                # We use a broader scope but limit it to Buttons to keep it relatively fast
                $btnCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button)
                $buttons = $win.FindAll([Windows.Automation.TreeScope]::Descendants, $btnCondition)
                
                foreach ($btn in $buttons) {
                    $btnName = $btn.Current.Name
                    $automationId = $btn.Current.AutomationId
                    
                    # Common meeting controls names (Localized) and Automation IDs
                    if ($btnName -match "Mute|Mudo|Microfone|Mic|Hang up|Sair|Leave|Desligar|Camera|Câmera|Share|Compartilhar|Participants|Participantes" -or 
                        $automationId -match "hangup|mute|share|roster|participant") {
                        $isMeeting = $true
                        break
                    }
                }
            }
            
            if ($isMeeting) {
                $results += $name
            }
        }
    } catch {
        # Ignore errors for specific windows (e.g. permission issues)
        continue
    }
}

# Ensure we output a valid JSON array
if ($results.Count -eq 0) {
    Write-Output "[]"
} else {
    $results | ConvertTo-Json -Compress
}
