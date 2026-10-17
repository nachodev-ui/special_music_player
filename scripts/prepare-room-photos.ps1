# Creates smaller copies for the 3D room; never writes to public/photos originals.
Add-Type -AssemblyName System.Drawing

$sourceDirectory = Join-Path $PSScriptRoot '..\public\photos'
$outputDirectory = Join-Path $sourceDirectory 'room'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$names = @(
  'sakura_day.jpg', 'zoo_atardecer.jpg', 'zoo_entrada.jpg',
  'ascensor.png', 'metro.jpg', 'roblox_day.jpg'
)
$jpegEncoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1

foreach ($name in $names) {
  $sourcePath = Join-Path $sourceDirectory $name
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    Write-Warning "Falta $sourcePath; la escena usara la imagen generica."
    continue
  }

  $source = [System.Drawing.Image]::FromFile($sourcePath)
  try {
    # Respect the camera orientation before measuring and resizing.
    if ($source.PropertyIdList -contains 274) {
      $orientation = [BitConverter]::ToUInt16($source.GetPropertyItem(274).Value, 0)
      $rotations = @{
        2 = 'RotateNoneFlipX'; 3 = 'Rotate180FlipNone'; 4 = 'Rotate180FlipX'
        5 = 'Rotate90FlipX'; 6 = 'Rotate90FlipNone'; 7 = 'Rotate270FlipX'; 8 = 'Rotate270FlipNone'
      }
      if ($rotations.ContainsKey([int]$orientation)) {
        $source.RotateFlip([System.Drawing.RotateFlipType]::$($rotations[[int]$orientation]))
      }
    }

    $scale = [Math]::Min(1.0, 1024.0 / [Math]::Max($source.Width, $source.Height))
    $width = [Math]::Max(1, [int][Math]::Round($source.Width * $scale))
    $height = [Math]::Max(1, [int][Math]::Round($source.Height * $scale))
    $isPng = [IO.Path]::GetExtension($name).ToLowerInvariant() -eq '.png'
    $format = if ($isPng) { [System.Drawing.Imaging.PixelFormat]::Format32bppArgb } else { [System.Drawing.Imaging.PixelFormat]::Format24bppRgb }
    $result = [System.Drawing.Bitmap]::new($width, $height, $format)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($result)
      try {
        $graphics.Clear($(if ($isPng) { [System.Drawing.Color]::Transparent } else { [System.Drawing.Color]::White }))
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($source, 0, 0, $width, $height)
      } finally {
        $graphics.Dispose()
      }

      $outputPath = Join-Path $outputDirectory $name
      if ($isPng) {
        $result.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
      } else {
        $parameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
        try {
          $parameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [long]88)
          $result.Save($outputPath, $jpegEncoder, $parameters)
        } finally {
          $parameters.Dispose()
        }
      }
      Write-Output "$name -> $width x $height"
    } finally {
      $result.Dispose()
    }
  } finally {
    $source.Dispose()
  }
}
