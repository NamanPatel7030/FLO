# A plain text window for the dictation test (Windows): its text is written to $Out several times a
# second, so the test can read what Flo inserted.
param([string]$Out)
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = "Flo E2E target"
$form.Width = 640; $form.Height = 240
$form.StartPosition = "Manual"; $form.Left = 80; $form.Top = 320
$form.TopMost = $true
$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true; $box.Dock = "Fill"
$box.Font = New-Object System.Drawing.Font("Segoe UI", 14)
$form.Controls.Add($box)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({ [System.IO.File]::WriteAllText($Out, $box.Text) })
$timer.Start()
$form.Add_Shown({ $form.Activate(); $box.Focus() })
[System.Windows.Forms.Application]::Run($form)
