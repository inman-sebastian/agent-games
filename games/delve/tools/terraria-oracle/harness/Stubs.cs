// Minimal stand-ins for the parts of Terraria that Liquid.cs and LiquidRenderer.cs touch. Only what compiles
// them; water only, single player, no world generation. Liquid.cs, LiquidBuffer.cs and LiquidRenderer.cs are
// the decompiled 1.4.0.5 files, unmodified.
using System;
using System.Collections.Generic;

namespace Microsoft.Xna.Framework
{
  public struct Vector2
  {
    public float X, Y;
    public Vector2(float x, float y) { X = x; Y = y; }
    public static Vector2 Zero => new Vector2(0, 0);
    public static Vector2 operator +(Vector2 a, Vector2 b) => new Vector2(a.X + b.X, a.Y + b.Y);
    public static Vector2 operator *(Vector2 a, float s) => new Vector2(a.X * s, a.Y * s);
  }
  public struct Point
  {
    public int X, Y;
    public Point(int x, int y) { X = x; Y = y; }
    public static Point Zero => new Point(0, 0);
  }
  public struct Rectangle
  {
    public int X, Y, Width, Height;
    public Rectangle(int x, int y, int w, int h) { X = x; Y = y; Width = w; Height = h; }
  }
  public struct Color
  {
    public byte R, G, B, A;
    public static Color White => new Color();
    public static Color operator *(Color c, float s) => c;
  }
  public class GameTime { public TimeSpan ElapsedGameTime; }
}

namespace Microsoft.Xna.Framework.Graphics
{
  public enum SurfaceFormat { Color }
  public enum SpriteEffects { None }
  public class GraphicsDevice { }
  public class SpriteBatch { }
  public class Texture2D : IDisposable
  {
    public int Width, Height;
    public Texture2D(GraphicsDevice d, int w, int h, bool m, SurfaceFormat f) { Width = w; Height = h; }
    public void SetData<T>(int level, Microsoft.Xna.Framework.Rectangle? r, T[] data, int start, int count) { }
    public void Dispose() { }
  }
}

namespace ReLogic.Content
{
  public enum AssetRequestMode { DoNotLoad, AsyncLoad, ImmediateLoad }
  public class Asset<T> { public T Value; }
}

namespace Terraria.Graphics
{
  public struct VertexColors
  {
    public Microsoft.Xna.Framework.Color TopLeftColor, TopRightColor, BottomLeftColor, BottomRightColor;
  }
}

namespace Terraria.Utilities
{
  public class UnifiedRandom
  {
    public int Next(int max) => 1; // only the lava bubble dust uses it
    public int Next(int min, int max) => min;
  }
}

namespace Terraria.Audio
{
  public static class SoundEngine { public static void PlaySound(object sound, Microsoft.Xna.Framework.Vector2 at) { } }
}

namespace Terraria.ID
{
  public static class SoundID { public static object LiquidsWaterLava, LiquidsHoneyLava, LiquidsHoneyWater; }
  public static class TileID
  {
    public static class Sets
    {
      public static bool[] IsAContainer = new bool[1000];
      public static bool[] Platforms = new bool[1000];
    }
  }
}

namespace Terraria.Localization
{
  public class NetworkText { }
  public static class Language { public static string GetTextValue(string key) => key; }
}

namespace Terraria.ObjectData
{
  public static class TileObjectData
  {
    public static bool CheckLavaDeath(Terraria.Tile t) => false;
    public static bool CheckWaterDeath(Terraria.Tile t) => false;
  }
}

namespace Terraria.GameContent.NetModules
{
  public static class NetLiquidModule { public static void CreateAndBroadcastByChunk(HashSet<int> set) { } }
}

namespace Terraria
{
  using Microsoft.Xna.Framework;

  public enum TileChangeType { None, LavaWater, HoneyWater, HoneyLava }

  public class Tile
  {
    public ushort type;
    public ushort wall;
    public byte liquid;
    bool _active, _checking, _skip, _half;
    byte _liquidType;
    public bool active() => _active;
    public void active(bool v) => _active = v;
    public bool nactive() => _active;
    public byte liquidType() => _liquidType;
    public void liquidType(int t) => _liquidType = (byte) t;
    public bool lava() => _liquidType == 1;
    public void lava(bool v) => _liquidType = (byte) (v ? 1 : 0);
    public bool honey() => _liquidType == 2;
    public bool checkingLiquid() => _checking;
    public void checkingLiquid(bool v) => _checking = v;
    public bool skipLiquid() => _skip;
    public void skipLiquid(bool v) => _skip = v;
    public bool halfBrick() => _half;
    public void halfBrick(bool v) => _half = v;
    public void color(byte c) { }
    public void slope(byte s) { }
  }

  public class Lang { public static LocalizedStub[] gen = new LocalizedStub[64]; }
  public class LocalizedStub { public string Value = ""; }
  public class PlayerStub { public bool active; }
  public class ClientStub { public bool[,] TileSections = new bool[1, 1]; }
  public static class Netplay { public static ClientStub[] Clients = new ClientStub[256]; }
  public static class NetMessage
  {
    public static void SendData(int a, int b, int c, Terraria.Localization.NetworkText t, int d, float e, float f, float g, int h, int i, int j) { }
    public static void SendTileSquare(int who, int x, int y, int size, TileChangeType type) { }
  }
  public static class Utils { public static void Swap<T>(ref T a, ref T b) { T t = a; a = b; b = t; } }

  public class DustStub { public Vector2 velocity; public bool noGravity; }
  public static class Dust
  {
    public static int lavaBubbles = 1000;
    public static int NewDust(Vector2 p, int w, int h, int type, float a, float b, int alpha, Color c, float s) => 0;
  }
  public static class Lighting
  {
    public static void GetCornerColors(int x, int y, out Terraria.Graphics.VertexColors v, float s) { v = default; }
  }
  public class TileBatchStub
  {
    public void Begin() { }
    public void End() { }
    public void Draw(Microsoft.Xna.Framework.Graphics.Texture2D t, Vector2 p, Rectangle? r, Terraria.Graphics.VertexColors v, Vector2 o, float s, Microsoft.Xna.Framework.Graphics.SpriteEffects e) { }
  }
  public class AssetsStub
  {
    public ReLogic.Content.Asset<T> Request<T>(string name, ReLogic.Content.AssetRequestMode mode) => new ReLogic.Content.Asset<T>();
  }
  public class MainInstanceStub { public Microsoft.Xna.Framework.Graphics.GraphicsDevice GraphicsDevice; }

  public static class Main
  {
    public static int maxTilesX, maxTilesY;
    public static Tile[,] tile;
    public static bool[] tileSolid = new bool[1000];
    public static bool[] tileSolidTop = new bool[1000];
    public static bool[] tileAlch = new bool[1000];
    public static bool[] tileObsidianKill = new bool[1000];
    public static bool[] tileCut = new bool[1000];
    public static int UnderworldLayer = int.MaxValue;
    public static int netMode = 0;
    public static bool dedServ = false;
    public static bool Setting_UseReducedMaxLiquids = false;
    public static Liquid[] liquid = new Liquid[Liquid.maxLiquid + 1];
    public static LiquidBuffer[] liquidBuffer = new LiquidBuffer[50001];
    public static PlayerStub[] player = new PlayerStub[256];
    public static int maxSectionsX = 1, maxSectionsY = 1;
    public static string statusText;
    public static double worldSurface = 0;
    public static DustStub[] dust = new DustStub[6001];
    public static TileBatchStub tileBatch = new TileBatchStub();
    public static AssetsStub Assets = new AssetsStub();
    public static MainInstanceStub instance = new MainInstanceStub();
    public static bool gamePaused, hasFocus = true;
    public static float windSpeedCurrent;
    public static void DrawTileInWater(Vector2 offset, int x, int y) { }
  }

  public static class WorldGen
  {
    public static bool gen, generatingWorld, getGoodWorldGen;
    public static int waterLine;
    public static Terraria.Utilities.UnifiedRandom genRandUnused;
    public static XorShift genRand = new XorShift();
    public static bool SolidTile(int x, int y, bool b) => Main.tile[x, y].active() && Main.tileSolid[Main.tile[x, y].type];
    public static bool SolidOrSlopedTile(Tile t) => t.active() && Main.tileSolid[t.type] && !Main.tileSolidTop[t.type];
    public static void KillTile(int i, int j, bool fail, bool effectOnly, bool noItem) { }
    public static bool PlaceTile(int i, int j, int type, bool mute, bool forced, int plr, int style) => false;
    public static void SquareTileFrame(int i, int j, bool resetFrame)
    {
      // WorldGen.SquareTileFrame → TileFrame on the 3×3, column by column; TileFrame wakes any liquid there
      for (int x = i - 1; x <= i + 1; ++x)
        for (int y = j - 1; y <= j + 1; ++y)
          if (x > 5 && y > 5 && x < Main.maxTilesX - 5 && y < Main.maxTilesY - 5 && Main.tile[x, y].liquid > 0)
            Liquid.AddWater(x, y);
    }
    public static void WaterCheck() { }
    public static bool InWorld(int x, int y, int fluff) => true;
    public static void CheckAlch(int x, int y) { }
    public static void CheckLilyPad(int x, int y) { }
  }

  /// <summary>WorldGen.genRand for the one liquid use (Next(30)): the same xorshift as the TypeScript port.</summary>
  public class XorShift
  {
    public uint state = 1;
    public int Next(int max)
    {
      state ^= state << 13;
      state ^= state >> 17;
      state ^= state << 5;
      return (int) (state % (uint) max);
    }
  }
}
