# Builds phone-friendly pronunciation files for the cards in cards.txt.
#
# Why: the CUHK syllable recordings are 8-bit / 11 kHz WAVs from 2005. iOS Safari won't
# play them and Android Chrome resamples them badly. This script downloads each syllable,
# converts it to standard 16-bit 22.05 kHz WAV, trims the silence, joins the syllables of
# a word into ONE file (audio/<jyutping>.wav), and points the card's audio field at it.
#
# Which cards it touches: cards whose audio field is blank or still points at the CUHK site.
# Cards with any other audio link (your own mp3s, etc.) are left alone.
#   Usage:  powershell -ExecutionPolicy Bypass -File tools\build-audio.ps1 [-Force]
#   -Force  rebuild the audio file even if it already exists.
param([switch]$Force)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path $PSScriptRoot -Parent
$cardsPath = Join-Path $root 'cards.txt'
$audioDir = Join-Path $root 'audio'
$sourceBase = 'https://humanum.arts.cuhk.edu.hk/Lexis/lexi-can/sound/'
New-Item -ItemType Directory -Force $audioDir | Out-Null

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

public static class CantoAudio {
    const int OutRate = 22050;

    // Parses a PCM WAV (8-bit unsigned or 16-bit signed) into mono floats at its own rate.
    public static float[] ReadWav(byte[] b, out int rate) {
        rate = 0; int bits = 0, channels = 1;
        if (b.Length < 12 || Encoding.ASCII.GetString(b, 0, 4) != "RIFF" || Encoding.ASCII.GetString(b, 8, 4) != "WAVE")
            throw new Exception("not a WAV file");
        int p = 12;
        while (p + 8 <= b.Length) {
            string id = Encoding.ASCII.GetString(b, p, 4);
            int size = BitConverter.ToInt32(b, p + 4);
            int body = p + 8;
            if (id == "fmt ") {
                if (BitConverter.ToInt16(b, body) != 1) throw new Exception("not PCM");
                channels = BitConverter.ToInt16(b, body + 2);
                rate = BitConverter.ToInt32(b, body + 4);
                bits = BitConverter.ToInt16(b, body + 14);
            } else if (id == "data") {
                size = Math.Min(size, b.Length - body);
                int bytesPer = bits / 8, frame = bytesPer * channels, n = size / frame;
                float[] s = new float[n];
                for (int i = 0; i < n; i++) {
                    int o = body + i * frame;
                    s[i] = bits == 8 ? (b[o] - 128) / 128f : BitConverter.ToInt16(b, o) / 32768f;
                }
                return s;
            }
            p = body + size + (size & 1);
        }
        throw new Exception("no data chunk");
    }

    static float[] Resample(float[] s, int from) {
        if (from == OutRate) return s;
        int n = (int)((long)s.Length * OutRate / from);
        float[] r = new float[n];
        double step = (double)from / OutRate;
        for (int i = 0; i < n; i++) {
            double x = i * step; int a = (int)x; double f = x - a;
            float s0 = s[Math.Min(a, s.Length - 1)], s1 = s[Math.Min(a + 1, s.Length - 1)];
            r[i] = (float)(s0 + (s1 - s0) * f);
        }
        return r;
    }

    static float[] Trim(float[] s) {
        const float thr = 0.03f; int pad = OutRate / 50; // 20 ms
        int a = 0, z = s.Length - 1;
        while (a < s.Length && Math.Abs(s[a]) < thr) a++;
        while (z > a && Math.Abs(s[z]) < thr) z--;
        if (a >= z) return s;
        a = Math.Max(0, a - pad); z = Math.Min(s.Length - 1, z + pad);
        float[] r = new float[z - a + 1];
        Array.Copy(s, a, r, 0, r.Length);
        int fade = Math.Min(OutRate / 200, r.Length / 2); // 5 ms fades avoid clicks
        for (int i = 0; i < fade; i++) { float g = (float)i / fade; r[i] *= g; r[r.Length - 1 - i] *= g; }
        return r;
    }

    // Joins syllable WAVs into one 16-bit mono 22.05 kHz WAV with short gaps between them.
    public static byte[] BuildWord(List<byte[]> syllables) {
        var all = new List<float>();
        int gap = OutRate * 8 / 100; // 80 ms
        all.AddRange(new float[OutRate / 20]); // 50 ms lead-in so phones don't clip the start
        for (int k = 0; k < syllables.Count; k++) {
            int rate; float[] s = ReadWav(syllables[k], out rate);
            s = Trim(Resample(s, rate));
            if (k > 0) all.AddRange(new float[gap]);
            all.AddRange(s);
        }
        all.AddRange(new float[OutRate / 20]);
        float peak = 0; foreach (float v in all) peak = Math.Max(peak, Math.Abs(v));
        float gain = peak > 0 ? 0.9f / peak : 1f;

        int dataLen = all.Count * 2;
        var ms = new MemoryStream(); var w = new BinaryWriter(ms);
        w.Write(Encoding.ASCII.GetBytes("RIFF")); w.Write(36 + dataLen); w.Write(Encoding.ASCII.GetBytes("WAVE"));
        w.Write(Encoding.ASCII.GetBytes("fmt ")); w.Write(16); w.Write((short)1); w.Write((short)1);
        w.Write(OutRate); w.Write(OutRate * 2); w.Write((short)2); w.Write((short)16);
        w.Write(Encoding.ASCII.GetBytes("data")); w.Write(dataLen);
        foreach (float v in all) w.Write((short)Math.Max(-32768, Math.Min(32767, Math.Round(v * gain * 32767))));
        w.Flush();
        return ms.ToArray();
    }

    // Minimal CSV split that honours "double quoted, fields".
    public static List<string> SplitCsv(string line) {
        var res = new List<string>(); var cur = new StringBuilder(); bool q = false;
        for (int i = 0; i < line.Length; i++) {
            char c = line[i];
            if (q) {
                if (c == '"' && i + 1 < line.Length && line[i + 1] == '"') { cur.Append('"'); i++; }
                else if (c == '"') q = false; else cur.Append(c);
            } else if (c == '"') q = true;
            else if (c == ',') { res.Add(cur.ToString().Trim()); cur.Clear(); }
            else cur.Append(c);
        }
        res.Add(cur.ToString().Trim());
        return res;
    }
}
'@

function Join-Csv([string[]]$fields) {
  ($fields | ForEach-Object { if ($_ -match '[",]') { '"' + ($_ -replace '"', '""') + '"' } else { $_ } }) -join ','
}

$web = New-Object Net.WebClient
$syllableCache = @{}
function Get-Syllable([string]$syl) {
  if (-not $syllableCache.ContainsKey($syl)) { $syllableCache[$syl] = $web.DownloadData($sourceBase + $syl + '.wav') }
  $syllableCache[$syl]
}

$utf8 = New-Object Text.UTF8Encoding($false)
$lines = [IO.File]::ReadAllLines($cardsPath, $utf8)
$built = 0; $skipped = 0; $failed = 0
for ($i = 0; $i -lt $lines.Length; $i++) {
  $line = $lines[$i]
  if (-not $line.Trim() -or $line.Trim().StartsWith('#')) { continue }
  $f = [CantoAudio]::SplitCsv($line)
  while ($f.Count -lt 4) { $f.Add('') }
  $audio = $f[3]
  $syllables = @($f[2].ToLower() -split '\s+' | Where-Object { $_ })
  if (-not $syllables.Count) { continue }
  $name = ($syllables -join '-') + '.wav'
  # Only touch blank fields, old CUHK links, or a file this script built itself.
  $isOurs = (-not $audio) -or $audio.Contains('humanum.arts.cuhk.edu.hk') -or ($audio -eq "audio/$name")
  if (-not $isOurs) { $skipped++; continue }
  $out = Join-Path $audioDir $name
  if ($Force -or -not (Test-Path $out)) {
    try {
      $data = New-Object 'System.Collections.Generic.List[byte[]]'
      foreach ($s in $syllables) { $data.Add((Get-Syllable $s)) }
      [IO.File]::WriteAllBytes($out, [CantoAudio]::BuildWord($data))
      $built++
    } catch {
      Write-Warning "$($f[1]) ($($f[2])): $($_.Exception.Message) - left unchanged"
      $failed++; continue
    }
  }
  $f[3] = "audio/$name"
  $lines[$i] = Join-Csv $f.ToArray()
}
[IO.File]::WriteAllText($cardsPath, (($lines -join "`n") + "`n"), $utf8)
Write-Host "Built $built audio file(s); $skipped card(s) with custom audio left alone; $failed failed."
