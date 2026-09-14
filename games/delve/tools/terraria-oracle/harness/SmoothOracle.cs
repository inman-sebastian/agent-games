// SmoothOracle.cs — runs grids through Terraria 1.4.0.5's own "Smooth World" pass (SmoothWorld.generated.cs) and
// writes each tile's active, slope and half-brick bits, for the TypeScript port (shared/src/slopes.ts) to match.
//
// Grid (JSON): width, height, state (the xorshift's starting state), active (column, then row). It sits in a world
// with a 19-tile margin, so the pass's loop bounds (20 … size − 20) visit exactly the grid's inner columns and rows
// the port visits. Above the grid is air, below it rock; the columns beyond it are never read.
using System;
using System.IO;
using System.Text;
using System.Text.Json;
using Terraria;

public static class SmoothOracle
{
  const int Margin = 19;

  public static void Run(string inputPath, string outputPath)
  {
    var input = JsonDocument.Parse(File.ReadAllText(inputPath)).RootElement;
    var output = new StringBuilder("[");
    bool first = true;
    foreach (var grid in input.EnumerateArray())
    {
      int width = grid.GetProperty("width").GetInt32();
      int height = grid.GetProperty("height").GetInt32();
      var active = grid.GetProperty("active");
      Main.maxTilesX = width + 38;
      Main.maxTilesY = height + 37;
      Main.tile = new Tile[Main.maxTilesX, Main.maxTilesY];
      Main.tileSolid[0] = true;
      Main.tileSolid[1] = true;
      for (int x = 0; x < Main.maxTilesX; ++x)
        for (int y = 0; y < Main.maxTilesY; ++y)
        {
          var tile = new Tile();
          int gx = x - Margin, gy = y - Margin;
          bool solid = gx >= 0 && gx < width && gy >= 0 && gy < height
            ? active[gx * height + gy].GetInt32() == 1
            : gy >= height;
          if (solid) { tile.active(true); tile.type = 1; }
          Main.tile[x, y] = tile;
        }
      WorldGen.gen = true;
      WorldGen.genRand.state = grid.GetProperty("state").GetUInt32();
      SmoothWorldPass.Run(new ProgressStub(), null);
      WorldGen.gen = false;
      if (!first) output.Append(',');
      first = false;
      var bits = new StringBuilder();
      for (int gx = 0; gx < width; ++gx)
        for (int gy = 0; gy < height; ++gy)
        {
          var tile = Main.tile[gx + Margin, gy + Margin];
          if (bits.Length > 0) bits.Append(',');
          bits.Append(tile.active() ? 1 : 0).Append(',').Append(tile.slope()).Append(',').Append(tile.halfBrick() ? 1 : 0);
        }
      output.Append("{\"tiles\":[").Append(bits).Append("]}");
    }
    output.Append(']');
    File.WriteAllText(outputPath, output.ToString());
  }
}
