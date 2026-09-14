// BehindOracle.cs — runs neighbourhoods through Terraria 1.4.0.5's own TileDrawing.DrawTile_LiquidBehindTile
// (TileDrawing.generated.cs) and writes the liquid rectangle it draws behind the middle tile, for the TypeScript
// port (client/src/fluid/terraria-liquid-render.ts, liquidBehindTile) to match.
//
// Scene (JSON): an array of 3×3 neighbourhoods, each `shapes` and `liquid` row by row (shape -1 open, 0 full,
// 1–4 slope; liquid 0–255 water). The middle tile is solid. The world is underground (tile row > worldSurface).
// Output per neighbourhood: 0 if nothing is drawn, else [x, y, source x, source y, width, height, colour scale].
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using Terraria;
using Terraria.DataStructures;
using Terraria.GameContent.Drawing;

public static class BehindOracle
{
  const int Margin = 5;

  public static void Run(string inputPath, string outputPath)
  {
    var input = JsonDocument.Parse(File.ReadAllText(inputPath)).RootElement;
    var output = new StringBuilder("[");
    bool first = true;
    Main.tileSolid[1] = true;
    Main.worldSurface = 0;
    foreach (var scene in input.EnumerateArray())
    {
      var shapes = scene.GetProperty("shapes");
      var liquid = scene.GetProperty("liquid");
      Main.maxTilesX = Main.maxTilesY = 3 + 2 * Margin;
      Main.tile = new Tile[Main.maxTilesX, Main.maxTilesY];
      for (int x = 0; x < Main.maxTilesX; ++x)
        for (int y = 0; y < Main.maxTilesY; ++y)
          Main.tile[x, y] = new Tile();
      for (int gy = 0; gy < 3; ++gy)
        for (int gx = 0; gx < 3; ++gx)
        {
          var tile = Main.tile[gx + Margin, gy + Margin];
          int shape = shapes[gy * 3 + gx].GetInt32();
          if (shape >= 0)
          {
            tile.active(true);
            tile.type = 1;
            tile.slope((byte) shape);
          }
          tile.liquid = (byte) liquid[gy * 3 + gx].GetInt32();
        }
      var drawing = new TileDrawing();
      int tileX = 1 + Margin, tileY = 1 + Margin;
      var middle = Main.tile[tileX, tileY];
      drawing.Behind(tileX, tileY, new TileDrawInfo { tileCache = middle, typeCache = middle.type });
      if (!first) output.Append(',');
      first = false;
      if (drawing.Draws == 0)
      {
        output.Append('0');
        continue;
      }
      var p = drawing.DrawnPosition;
      var r = drawing.DrawnSize;
      output.Append('[').Append(p.X - tileX * 16).Append(',').Append(p.Y - tileY * 16).Append(',')
        .Append(r.X).Append(',').Append(r.Y).Append(',').Append(r.Width).Append(',').Append(r.Height).Append(',')
        .Append(drawing.DrawnScale.ToString("R", CultureInfo.InvariantCulture)).Append(']');
    }
    output.Append(']');
    File.WriteAllText(outputPath, output.ToString());
  }
}
