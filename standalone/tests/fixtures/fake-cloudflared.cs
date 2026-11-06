// Test-only process: announces a fake Quick Tunnel and never contacts Cloudflare.
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

public static class FakeCloudflared {
    public static int Main(string[] args) {
        if (args.Length == 1 && args[0] == "--version") {
            Console.WriteLine("cloudflared version 2026.11.0 (fixture)");
            return 0;
        }
        string output = Environment.GetEnvironmentVariable("SUDOKU_TUNNEL_FIXTURE_OUTPUT");
        if (String.IsNullOrEmpty(output)) return 2;
        string origin = "";
        for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--url") origin = args[i + 1];
        File.WriteAllLines(output, new string[] { Process.GetCurrentProcess().Id.ToString(), origin, String.Join("\n", args) });
        Console.Error.WriteLine("INF Your quick Tunnel has been created! Visit it at:");
        Console.Error.WriteLine("https://sudoku-fixture.trycloudflare.com");
        Console.Error.WriteLine("INF Registered tunnel connection connIndex=0 connection=fixture protocol=quic");
        Console.Error.Flush();
        while (!File.Exists(output + ".stop")) Thread.Sleep(50);
        return 0;
    }
}
