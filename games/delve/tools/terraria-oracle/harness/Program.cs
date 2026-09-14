// The oracle: runs scenes through Terraria 1.4.0.5's own Liquid.cs and LiquidRenderer.cs and writes what they
// produce, for the TypeScript port's tests to match exactly. `smooth <in> <out>` runs the Smooth World pass
// instead (SmoothOracle.cs), `collision <in> <out>` the player collision methods (CollisionOracle.cs). Run fetch.sh
// first.
//
// Scene (JSON): rows ('#' rock, '~' full water, '.' open), updates, snapshotEvery, events [{at, op, x, y, amount}].
// The grid sits in a world with a 10-tile rock margin. At start every wet tile joins the list (x, then y).
// Each update: apply that update's events, then Liquid.UpdateLiquid() — Terraria calls it every second world
// update. dig/build change the tile and call SquareTileFrame, as KillTile/PlaceTile do; pour adds liquid and calls
// SquareTileFrame, as a bucket does.
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.Xna.Framework;
using Terraria;
using Terraria.GameContent.Liquid;

if (args[0] == "smooth")
{
  SmoothOracle.Run(args[1], args[2]);
  return;
}
if (args[0] == "collision")
{
  CollisionOracle.Run(args[1], args[2]);
  return;
}

const int Margin = 10;
var input = JsonDocument.Parse(File.ReadAllText(args[0])).RootElement;
var output = new StringBuilder("[");
bool firstScene = true;
foreach (var scene in input.EnumerateArray())
{
  var rows = new List<string>();
  foreach (var row in scene.GetProperty("rows").EnumerateArray()) rows.Add(row.GetString());
  int height = rows.Count, width = rows[0].Length;
  int updates = scene.GetProperty("updates").GetInt32();
  int every = scene.GetProperty("snapshotEvery").GetInt32();

  Main.maxTilesX = width + 2 * Margin;
  Main.maxTilesY = height + 2 * Margin;
  Main.tile = new Tile[Main.maxTilesX, Main.maxTilesY];
  Main.tileSolid[1] = true;
  for (int x = 0; x < Main.maxTilesX; ++x)
    for (int y = 0; y < Main.maxTilesY; ++y)
    {
      var t = new Tile();
      int gx = x - Margin, gy = y - Margin;
      bool inside = gx >= 0 && gy >= 0 && gx < width && gy < height;
      char c = inside ? rows[gy][gx] : '#';
      if (c == '#') { t.active(true); t.type = 1; }
      if (c == '~') t.liquid = 255;
      if (c == 'L') { t.liquid = 255; t.lava(true); }
      Main.tile[x, y] = t;
    }
  for (int i = 0; i < Main.liquid.Length; ++i) Main.liquid[i] = new Liquid();
  for (int i = 0; i < Main.liquidBuffer.Length; ++i) Main.liquidBuffer[i] = new LiquidBuffer();
  Liquid.ReInit();
  Liquid.cycles = 7; // Main: 17 − 10 · gfxQuality, at full quality
  Liquid.curMaxLiquid = Liquid.maxLiquid;
  LiquidBuffer.numLiquidBuffer = 0;
  WorldGen.genRand.state = 1;
  for (int x = 0; x < Main.maxTilesX; ++x)
    for (int y = 0; y < Main.maxTilesY; ++y)
      if (Main.tile[x, y].liquid > 0) Liquid.AddWater(x, y);

  // a fresh renderer per scene: the camera holds still on the grid, and its cache carries over frame to frame
  LiquidRenderer.LoadContent();
  var events = scene.TryGetProperty("events", out var ev) ? ev : default;
  if (!firstScene) output.Append(',');
  firstScene = false;
  output.Append("{\"name\":").Append(JsonSerializer.Serialize(scene.GetProperty("name").GetString())).Append(",\"snapshots\":[");
  bool firstSnapshot = true;
  for (int u = 0; u <= updates; ++u)
  {
    // Main.RenderWater, one frame in four at 60 a second: once every second liquid update
    if (u % 2 == 0) PrepareFrame(width, height);
    if (u % every == 0)
    {
      if (!firstSnapshot) output.Append(',');
      firstSnapshot = false;
      WriteSnapshot(output, u, width, height);
    }
    if (u == updates) break;
    if (events.ValueKind == JsonValueKind.Array)
      foreach (var e in events.EnumerateArray())
      {
        if (e.GetProperty("at").GetInt32() != u) continue;
        int x = e.GetProperty("x").GetInt32() + Margin, y = e.GetProperty("y").GetInt32() + Margin;
        string op = e.GetProperty("op").GetString();
        var t = Main.tile[x, y];
        if (op == "dig") { t.active(false); t.type = 0; }
        else if (op == "build") { t.active(true); t.type = 1; }
        else if (op == "pour") t.liquid = (byte) Math.Min(255, t.liquid + e.GetProperty("amount").GetInt32());
        WorldGen.SquareTileFrame(x, y, true);
      }
    Liquid.UpdateLiquid();
  }
  output.Append("]}");
}
output.Append(']');
File.WriteAllText(args[1], output.ToString());

// as in the game, the prepared area reaches past what is shown: its last rows skip the waterfall pass
const int Reach = 8;

static void PrepareFrame(int width, int height)
{
  LiquidRenderer.Instance.PrepareDraw(new Rectangle(Margin - Reach, Margin - Reach, width + 2 * Reach, height + 2 * Reach));
}

static void WriteSnapshot(StringBuilder output, int update, int width, int height)
{
  var levels = new StringBuilder();
  for (int y = 0; y < height; ++y)
    for (int x = 0; x < width; ++x)
    {
      if (levels.Length > 0) levels.Append(',');
      levels.Append(Main.tile[x + Margin, y + Margin].liquid);
    }
  // the draw cache, column by column (x, then y), as the last frame left it
  var cache = (Array) typeof(LiquidRenderer).GetField("_drawCache", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(LiquidRenderer.Instance);
  var draw = new StringBuilder();
  for (int y = 0; y < height; ++y)
    for (int x = 0; x < width; ++x)
    {
      object entry = cache.GetValue((x + Reach) * (height + 2 * Reach) + y + Reach);
      var type = entry.GetType();
      bool visible = (bool) type.GetField("IsVisible").GetValue(entry);
      if (draw.Length > 0) draw.Append(',');
      if (!visible) { draw.Append("0"); continue; }
      var source = (Rectangle) type.GetField("SourceRectangle").GetValue(entry);
      var offset = (Vector2) type.GetField("LiquidOffset").GetValue(entry);
      float opacity = (float) type.GetField("Opacity").GetValue(entry);
      bool surface = (bool) type.GetField("IsSurfaceLiquid").GetValue(entry);
      draw.Append('[').Append(source.X).Append(',').Append(source.Y).Append(',').Append(source.Width).Append(',').Append(source.Height)
        .Append(',').Append(offset.X).Append(',').Append(offset.Y).Append(',').Append(Math.Round(opacity, 4).ToString(System.Globalization.CultureInfo.InvariantCulture))
        .Append(',').Append(surface ? 1 : 0).Append(']');
    }
  var list = new StringBuilder();
  if (Environment.GetEnvironmentVariable("ORACLE_LIST") == "1")
    for (int l = 0; l < Liquid.numLiquid; ++l)
    {
      if (list.Length > 0) list.Append(',');
      list.Append('[').Append(Main.liquid[l].x - Margin).Append(',').Append(Main.liquid[l].y - Margin).Append(',').Append(Main.liquid[l].kill).Append(']');
    }
  output.Append("{\"update\":").Append(update).Append(",\"active\":").Append(Liquid.numLiquid).Append(",\"list\":[").Append(list).Append(']')
    .Append(",\"levels\":[").Append(levels).Append("],\"draw\":[").Append(draw).Append("]}");
}
