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
        if ($process -and ($process.ProcessName -match "ms-teams|Teams|msteams")) {
            [Console]::Error.WriteLine("DEBUG: Analisando processo Teams: $($process.ProcessName) - Janela: $name")
            
            $isMeeting = $false
            
            # 1. Check if the window title suggests a meeting (highly likely)
            if ($name -match "Reunião|Meeting|Call|Chamada|Conferência|Em curso|In progress|Ativo|Active") {
                [Console]::Error.WriteLine("DEBUG: Identificado por título: $name")
                $isMeeting = $true
            }

            # If not identified by title, check if we should exclude it or do a deep check
            if (-not $isMeeting) {
                # Filter out known non-meeting windows early
                # We use more specific regex to avoid excluding actual meetings that have "Microsoft Teams" in the title
                if ($name -match "^Chat \||^Calendar \||^Notificações \||^Notifications \||^Atividade \||^Activity \|" -or $name -eq "Microsoft Teams") {
                    [Console]::Error.WriteLine("DEBUG: Janela ignorada (lista de exclusão): $name")
                    continue
                }
            }

            # 2. Deep check only if not already confirmed
            if (-not $isMeeting) {
                [Console]::Error.WriteLine("DEBUG: Iniciando busca profunda em: $name")
                
                # Broaden search: Teams v2 often uses 'Custom' or other types for its web-based UI
                $condition = [Windows.Automation.Condition]::TrueCondition
                $elements = $win.FindAll([Windows.Automation.TreeScope]::Descendants, $condition)
                
                # If we only found the window itself, try to look for child windows (Teams v2 nested structure)
                if ($elements.Count -le 1) {
                    [Console]::Error.WriteLine("DEBUG: Poucos elementos na janela principal. Verificando sub-janelas...")
                    $childWinCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Window)
                    $childWindows = $win.FindAll([Windows.Automation.TreeScope]::Children, $childWinCondition)
                    [Console]::Error.WriteLine("DEBUG: Sub-janelas encontradas: $($childWindows.Count)")
                    
                    foreach ($cWin in $childWindows) {
                        $elements += $cWin.FindAll([Windows.Automation.TreeScope]::Descendants, $condition)
                    }
                }

                [Console]::Error.WriteLine("DEBUG: Elementos totais analisados: $($elements.Count)")
                
                foreach ($el in $elements) {
                    try {
                        $elName = $el.Current.Name
                        $automationId = $el.Current.AutomationId
                        
                        # Avoid matching the window title itself
                        if ($elName -eq $name) { continue }

                        # Common meeting controls names (Localized) and Automation IDs
                        if ($elName -match "Mute|Mudo|Microfone|\bMic\b|Hang up|Sair|Leave|Desligar|Camera|Câmera|Share|Compartilhar|Participants|Participantes|Rec |Gravar" -or 
                            $automationId -match "hangup|mute|share|roster|participant|call-controls|recording|join-button") {
                            [Console]::Error.WriteLine("DEBUG: Reunião CONFIRMADA por elemento interno: '$elName' (ID: $automationId)")
                            $isMeeting = $true
                            break
                        }
                    } catch { continue }
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
    # Force array output by using , (comma operator) or @() with ConvertTo-Json -InputObject
    # Standard way in PS 5.1 to ensure array if count is 1:
    if ($results.Count -eq 1) {
        Write-Output "[$($results[0] | ConvertTo-Json -Compress)]"
    } else {
        $results | ConvertTo-Json -Compress
    }
}
