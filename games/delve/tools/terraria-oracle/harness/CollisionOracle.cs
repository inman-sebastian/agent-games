// CollisionOracle.cs — runs bodies through Terraria 1.4.0.5's own player collision methods (Collision.generated.cs)
// and writes what each returns, for the TypeScript port (shared/src/collision.ts) to match.
//
// Scene (JSON): width, height, shapes (column, then row: -1 open, 0 full, 1–4 slope), cases [{x, y, vx, vy, w, h,
// gravity}] in pixels from the grid's top-left. The grid sits in a world with an open 10-tile margin, so no scan
// reaches the world's clamps. Every case runs through all five methods from the same start, gravity down.
using System;
using System.IO;
using System.Text;
using System.Text.Json;
using Microsoft.Xna.Framework;
using Terraria;

public static class CollisionOracle
{
  const int Margin = 10;

  public static void Run(string inputPath, string outputPath)
  {
    var input = JsonDocument.Parse(File.ReadAllText(inputPath)).RootElement;
    var output = new StringBuilder("[");
    bool firstScene = true;
    foreach (var scene in input.EnumerateArray())
    {
      int width = scene.GetProperty("width").GetInt32();
      int height = scene.GetProperty("height").GetInt32();
      var shapes = scene.GetProperty("shapes");
      Main.maxTilesX = width + 2 * Margin;
      Main.maxTilesY = height + 2 * Margin;
      Main.tile = new Tile[Main.maxTilesX, Main.maxTilesY];
      Main.tileSolid[1] = true;
      for (int x = 0; x < Main.maxTilesX; ++x)
        for (int y = 0; y < Main.maxTilesY; ++y)
        {
          var tile = new Tile();
          int gx = x - Margin, gy = y - Margin;
          int shape = gx >= 0 && gx < width && gy >= 0 && gy < height ? shapes[gx * height + gy].GetInt32() : -1;
          if (shape >= 0)
          {
            tile.active(true);
            tile.type = 1;
            tile.slope((byte) shape);
          }
          Main.tile[x, y] = tile;
        }

      if (!firstScene) output.Append(',');
      firstScene = false;
      output.Append('[');
      bool firstCase = true;
      float offset = Margin * 16;
      foreach (var body in scene.GetProperty("cases").EnumerateArray())
      {
        var position = new Vector2(body.GetProperty("x").GetSingle() + offset, body.GetProperty("y").GetSingle() + offset);
        var velocity = new Vector2(body.GetProperty("vx").GetSingle(), body.GetProperty("vy").GetSingle());
        int w = body.GetProperty("w").GetInt32();
        int h = body.GetProperty("h").GetInt32();
        float gravity = body.GetProperty("gravity").GetSingle();

        var walk = Collision.WalkDownSlope(position, velocity, w, h, gravity);
        var slope = Collision.SlopeCollision(position, velocity, w, h, gravity, false);
        var tileVelocity = Collision.TileCollision(position, velocity, w, h, false, false, 1);
        bool up = Collision.up, down = Collision.down;

        var downPosition = position;
        var downVelocity = velocity;
        float downSpeed = 0, downOffset = 0;
        Collision.StepDown(ref downPosition, ref downVelocity, w, h, ref downSpeed, ref downOffset, 1, false);

        var upPosition = position;
        var upVelocity = velocity;
        float upSpeed = 0, upOffset = 0;
        Collision.StepUp(ref upPosition, ref upVelocity, w, h, ref upSpeed, ref upOffset, 1, false, 0);

        if (!firstCase) output.Append(',');
        firstCase = false;
        output.Append("{\"walk\":").Append(Numbers(walk.X - offset, walk.Y - offset, walk.Z, walk.W));
        output.Append(",\"slope\":").Append(Numbers(slope.X - offset, slope.Y - offset, slope.Z, slope.W));
        output.Append(",\"tile\":").Append(Numbers(tileVelocity.X, tileVelocity.Y, up ? 1 : 0, down ? 1 : 0));
        output.Append(",\"stepDown\":").Append(Numbers(downPosition.Y - offset, downVelocity.Y, downSpeed, downOffset));
        output.Append(",\"stepUp\":").Append(Numbers(upPosition.Y - offset, upVelocity.Y, upSpeed, upOffset));
        output.Append('}');
      }
      output.Append(']');
    }
    output.Append(']');
    File.WriteAllText(outputPath, output.ToString());
  }

  // "R" round-trips a single exactly; the port compares within a hundredth of a pixel.
  static string Numbers(params float[] values)
  {
    var parts = new string[values.Length];
    for (int i = 0; i < values.Length; ++i)
      parts[i] = values[i].ToString("R", System.Globalization.CultureInfo.InvariantCulture);
    return "[" + string.Join(",", parts) + "]";
  }
}
