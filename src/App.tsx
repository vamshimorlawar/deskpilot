import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";

import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { 
  Bot, 
  Folder, 
  Image, 
  ArrowLeft, 
  FolderOpen, 
  Brain, 
  CheckCircle, 
  RotateCcw, 
  X, 
  Package, 
  Undo2, 
  RefreshCw, 
  AlertCircle, 
  Download, 
  Play, 
  ExternalLink,
  Loader2,
  Circle,
  FileText,
  Move3D,
  Sparkles,
  Zap,
  Square
} from "lucide-react";

type FolderPlan = {
  name: string;
  description: string;
  files: string[];
};

type OrgPlan = {
  folders: FolderPlan[];
  summary: string;
};

type OllamaStatus = {
  installed: boolean;
  running: boolean;
  has_model: boolean;
};

type OrganizeResult = {
  files_count: number;
  folders_created: number;
  moves: number;
  summary: string;
};

type Step = "idle" | "planning" | "preview" | "executing" | "done";
type View = "home" | "file" | "photos";

function App() {
  const [view, setView] = useState<View>("home");

  const [folder, setFolder] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [plan, setPlan] = useState<OrgPlan | null>(null);
  const [result, setResult] = useState<OrganizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);

  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [ollamaLoading, setOllamaLoading] = useState(false);

  const loadOllamaStatus = async () => {
    setOllamaLoading(true);
    try {
      const status = await invoke<OllamaStatus>("ollama_status");
      setOllama(status);
    } catch {
      setOllama({ installed: false, running: false, has_model: false });
    } finally {
      setOllamaLoading(false);
    }
  };

  useEffect(() => {
    loadOllamaStatus();
  }, []);

  const handleOpenOllamaWebsite = async () => {
    try {
      await shellOpen("https://ollama.com");
    } catch (e: any) {
      setError("Could not open browser. Visit https://ollama.com manually.");
    }
  };
  const handleStartOllama = async () => {
    try {
      await invoke<string>("start_ollama");
      // give it a moment to boot, then refresh status
      setTimeout(loadOllamaStatus, 1500);
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to start Ollama");
    }
  };
  const handlePullModel = async () => {
    try {
      setError(null);
      // Optional: you can show a "downloading model..." message somewhere
      await invoke<string>("pull_default_model");
      // Refresh status to reflect model presence
      loadOllamaStatus();
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to download model");
    }
  };

  const handleStopOllama = async () => {
  try {
    await invoke<string>("stop_ollama");
    // Wait a moment for process to die, then refresh
    setTimeout(loadOllamaStatus, 1500);
  } catch (e: any) {
    setError(e?.toString() ?? "Failed to stop Ollama");
  }
};

  const resetAgentState = () => {
    setFolder("");
    setStep("idle");
    setPlan(null);
    setResult(null);
    setError(null);
    setUndoMessage(null);
  };

  const goHome = () => {
    resetAgentState();
    setView("home");
  };

  const pickFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title:
          view === "file"
            ? "Select a folder to organize (files)"
            : "Select a folder with photos",
      });

      if (typeof selected === "string") {
        setFolder(selected);
        setError(null);
      }
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to open folder picker");
    }
  };

  const startPlanning = async () => {
    if (!folder.trim()) {
      setError("Please pick a folder first");
      return;
    }
    setError(null);
    setPlan(null);
    setResult(null);
    setUndoMessage(null);
    setStep("planning");

    const cmd = view === "file" ? "plan_folder" : "plan_photos";

    try {
      const p = await invoke<OrgPlan>(cmd, { path: folder.trim() });
      setPlan(p);
      setStep("preview");
    } catch (e: any) {
      setError(e?.toString() ?? "Unknown error");
      setStep("idle");
    }
  };

  const regeneratePlan = async () => {
    if (!folder.trim()) return;
    setError(null);
    setStep("planning");

    const cmd = view === "file" ? "plan_folder" : "plan_photos";

    try {
      const p = await invoke<OrgPlan>(cmd, { path: folder.trim() });
      setPlan(p);
      setStep("preview");
    } catch (e: any) {
      setError(e?.toString() ?? "Unknown error");
      setStep("idle");
    }
  };

  const executePlan = async () => {
    if (!plan || !folder.trim()) return;
    setError(null);
    setUndoMessage(null);
    setStep("executing");

    const cmd = view === "file" ? "execute_plan" : "execute_photo_plan";

    try {
      const res = await invoke<OrganizeResult>(cmd, {
        path: folder.trim(),
        plan,
      });
      setResult(res);
      setStep("done");
    } catch (e: any) {
      setError(e?.toString() ?? "Unknown error");
      setStep("preview");
    }
  };

  const handleUndo = async () => {
    setError(null);
    setUndoMessage(null);

    try {
      const msg = await invoke<string>("undo_last");
      setUndoMessage(msg);
      setResult(null);
    } catch (e: any) {
      setError(e?.toString() ?? "Undo failed");
    }
  };

  // --- Render sections ---

  const AgentHeader = () => {
    const title =
      view === "file" ? "File Organizer" : "Photo Organizer";
    const subtitle =
      view === "file"
        ? "AI plans a folder structure for your files. You approve it, then it organizes everything."
        : "AI groups your photos into sensible folders (screenshots, work assets, vacation, etc.).";

    return (
      <div className="space-y-4 mb-6">
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 -ml-1 cursor-pointer"
          onClick={goHome}
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to agents
        </Button>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold flex items-center gap-3 text-slate-50">
            {view === "file" ? (
              <div className="p-2 bg-blue-500/20 rounded-lg border border-blue-500/30">
                <Folder className="w-6 h-6 text-blue-400" />
              </div>
            ) : (
              <div className="p-2 bg-purple-500/20 rounded-lg border border-purple-500/30">
                <Image className="w-6 h-6 text-purple-400" />
              </div>
            )}
            {title}
          </h1>
          <p className="text-slate-300 text-base leading-relaxed max-w-2xl">{subtitle}</p>
        </div>
      </div>
    );
  };

  const AgentBody = () => (
    <Card className="bg-slate-900/60 border-slate-800 backdrop-blur-sm shadow-xl">
      <CardContent className="p-8 space-y-6">
        <div className="space-y-3">
          <label className="text-base font-medium text-slate-200 flex items-center gap-2">
            <FolderOpen className="w-4 h-4" />
            Select folder to organize
          </label>
          <div className="flex gap-3">
            <Input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="Choose a folder or enter path manually"
              className="bg-slate-950/80 border-slate-700 text-slate-100 placeholder:text-slate-500 text-base h-11 focus:border-blue-500 transition-colors"
            />
            <Button
              type="button"
              variant="outline"
              className="border-slate-600 hover:bg-slate-700 hover:text-slate-100 px-4 h-11 transition-all hover:border-slate-500 font-medium cursor-pointer"
              onClick={pickFolder}
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              Browse
            </Button>
          </div>
        </div>

        {step === "idle" && (
          <Button
            onClick={startPlanning}
            className="w-full h-12 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold rounded-lg transition-all transform hover:scale-[1.02] shadow-lg cursor-pointer disabled:cursor-not-allowed"
            disabled={!folder.trim()}
          >
            <Sparkles className="w-5 h-5 mr-2" />
            Generate AI Organization Plan
          </Button>
        )}

        {step === "planning" && (
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                <Brain className="w-4 h-4 text-blue-300 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
              </div>
              <p className="text-slate-300 font-medium">AI is analyzing your folder...</p>
              <p className="text-slate-500 text-sm">This might take a moment</p>
            </div>
          </div>
        )}

        {step === "preview" && plan && (
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-500/20 rounded-lg">
                  <FileText className="w-4 h-4 text-emerald-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-100">Organization Plan</h3>
              </div>
              <p className="text-slate-300 bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                {plan.summary}
              </p>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950/60">
              <div className="p-4 space-y-3">
                {plan.folders.map((f, index) => (
                  <Card
                    key={f.name}
                    className="bg-slate-800/40 border-slate-700 hover:bg-slate-800/60 transition-colors"
                  >
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <div className="flex items-center justify-center w-6 h-6 bg-blue-500/20 rounded border border-blue-500/30">
                          <span className="text-xs font-bold text-blue-400">{index + 1}</span>
                        </div>
                        <Folder className="w-4 h-4 text-blue-400" />
                        <span className="text-slate-200">{f.name}/</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-sm text-slate-400 mb-3 leading-relaxed">
                        {f.description}
                      </p>
                      <div className="bg-slate-950/60 rounded-lg p-3 border border-slate-800">
                        <p className="text-xs text-slate-500 mb-2 font-medium">Files to move ({f.files.length}):</p>
                        <div className="space-y-1 max-h-20 overflow-y-auto">
                          {f.files.map((file) => (
                            <div key={file} className="flex items-center gap-2 text-xs text-slate-300">
                              <Circle className="w-2 h-2 fill-current text-slate-600" />
                              {file}
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                onClick={executePlan}
                className="flex-1 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-semibold h-11 rounded-lg transition-all transform hover:scale-[1.02] shadow-lg cursor-pointer"
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Apply This Plan
              </Button>
              <Button
                variant="outline"
                className="border-slate-600 hover:bg-slate-800 hover:text-slate-100 h-11 px-4 transition-all hover:border-slate-500 cursor-pointer"
                onClick={regeneratePlan}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Regenerate
              </Button>
              <Button
                variant="ghost"
                className="text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 h-11 px-4 cursor-pointer"
                onClick={resetAgentState}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {step === "executing" && (
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                <Move3D className="w-4 h-4 text-emerald-300 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
              </div>
              <p className="text-slate-300 font-medium">Organizing your files...</p>
              <p className="text-slate-500 text-sm">Moving files to their new locations</p>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-6">
            <div className="text-center space-y-3">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-500/20 rounded-full">
                <CheckCircle className="w-8 h-8 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-slate-100">Organization Complete!</h3>
                <p className="text-slate-300 mt-1">{result.summary}</p>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-800/40 rounded-lg p-4 border border-slate-700 text-center">
                <div className="text-2xl font-bold text-blue-400">{result.files_count}</div>
                <div className="text-xs text-slate-400 mt-1 flex items-center justify-center gap-1">
                  <FileText className="w-3 h-3" />
                  Items Scanned
                </div>
              </div>
              <div className="bg-slate-800/40 rounded-lg p-4 border border-slate-700 text-center">
                <div className="text-2xl font-bold text-emerald-400">{result.folders_created}</div>
                <div className="text-xs text-slate-400 mt-1 flex items-center justify-center gap-1">
                  <Folder className="w-3 h-3" />
                  Folders Created
                </div>
              </div>
              <div className="bg-slate-800/40 rounded-lg p-4 border border-slate-700 text-center">
                <div className="text-2xl font-bold text-purple-400">{result.moves}</div>
                <div className="text-xs text-slate-400 mt-1 flex items-center justify-center gap-1">
                  <Package className="w-3 h-3" />
                  Files Moved
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={handleUndo}
                variant="destructive"
                className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 hover:border-red-500/50 h-11 font-medium transition-all cursor-pointer"
              >
                <Undo2 className="w-4 h-4 mr-2" />
                Undo Everything
              </Button>
              <Button
                variant="outline"
                className="flex-1 border-slate-600 hover:bg-slate-800 hover:text-slate-100 h-11 transition-all hover:border-slate-500 cursor-pointer"
                onClick={resetAgentState}
              >
                <Zap className="w-4 h-4 mr-2" />
                Organize Another
              </Button>
            </div>

            {undoMessage && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-300 font-medium">{undoMessage}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="text-red-300">{error}</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const Home = () => (
    <div className="space-y-8">
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center">
          <div className="p-4 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-2xl border border-blue-500/30">
            <Bot className="w-12 h-12 text-blue-400" />
          </div>
        </div>
        <div>
          <h1 className="text-4xl font-bold text-slate-50 mb-2">
            DeskPilot
          </h1>
          <div className="flex items-center justify-center gap-2 text-slate-400 mb-3">
            <div className="w-1 h-1 rounded-full bg-emerald-400"></div>
            <span className="text-sm font-medium">Local AI Agents</span>
            <div className="w-1 h-1 rounded-full bg-emerald-400"></div>
          </div>
          <p className="text-slate-300 text-lg max-w-2xl mx-auto leading-relaxed">
            Intelligent file organization powered by AI that runs entirely on your machine. 
            No subscriptions, no cloud uploads, complete privacy.
          </p>
        </div>
      </div>

      <div className="grid gap-6 grid-cols-1 md:grid-cols-2 max-w-4xl mx-auto">
        <Card
          className="group bg-gradient-to-br from-slate-900/90 to-slate-800/50 border-slate-700 hover:border-blue-500/50 cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-xl backdrop-blur-sm"
          onClick={() => {
            resetAgentState();
            setView("file");
          }}
        >
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-500/20 rounded-xl border border-blue-500/30 group-hover:bg-blue-500/30 transition-colors">
                  <Folder className="w-6 h-6 text-blue-400" />
                </div>
                <CardTitle className="text-xl font-bold text-slate-100">
                  File Organizer
                </CardTitle>
              </div>
              <ArrowLeft className="w-4 h-4 text-slate-400 rotate-180 group-hover:text-blue-400 transition-colors" />
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <p className="text-slate-300 leading-relaxed">
              Transform chaotic folders into organized structures instantly. AI analyzes your files 
              and creates a logical organization system.
            </p>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <div className="flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                <span>Smart categorization</span>
              </div>
              <div className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                <span>One-click cleanup</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className="group bg-gradient-to-br from-slate-900/90 to-slate-800/50 border-slate-700 hover:border-purple-500/50 cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-xl backdrop-blur-sm"
          onClick={() => {
            resetAgentState();
            setView("photos");
          }}
        >
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-500/20 rounded-xl border border-purple-500/30 group-hover:bg-purple-500/30 transition-colors">
                  <Image className="w-6 h-6 text-purple-400" />
                </div>
                <CardTitle className="text-xl font-bold text-slate-100">
                  Photo Organizer
                </CardTitle>
              </div>
              <ArrowLeft className="w-4 h-4 text-slate-400 rotate-180 group-hover:text-purple-400 transition-colors" />
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <p className="text-slate-300 leading-relaxed">
              Automatically sort photos into meaningful categories like screenshots, 
              work assets, vacation memories, and more.
            </p>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <div className="flex items-center gap-1">
                <Brain className="w-3 h-3" />
                <span>Smart recognition</span>
              </div>
              <div className="flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                <span>Auto-grouping</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {!ollama?.running && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-center max-w-2xl mx-auto">
          <div className="flex items-center justify-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <span className="text-amber-300 font-medium">Setup Required</span>
          </div>
          <p className="text-amber-200 text-sm">
            Ollama needs to be installed and running to power the AI agents.{" "}
            <a
              href="https://ollama.com"
              className="underline hover:text-amber-100 transition-colors"
              target="_blank"
              rel="noreferrer"
            >
              Download from ollama.com
            </a>
          </p>
        </div>
      )}

      <div className="text-center max-w-md mx-auto">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
          <span className="text-emerald-400 text-sm font-medium">100% Private</span>
        </div>
        <p className="text-slate-400 text-sm">
          All processing happens locally on your machine. Your files never leave your computer.
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Top status bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-slate-900/40 border border-slate-800/60 rounded-xl p-4 backdrop-blur-sm shadow-lg gap-4 sm:gap-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></div>
              <span className="font-semibold text-slate-100 text-sm">DeskPilot</span>
            </div>
            <div className="w-px h-4 bg-slate-700 hidden sm:block"></div>
            <span className="text-slate-400 text-xs">Local AI Agents</span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {ollamaLoading && (
              <div className="flex items-center gap-2">
                <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />
                <span className="text-slate-400 text-xs">Checking Ollama...</span>
              </div>
            )}

            {!ollamaLoading && ollama && (
              <>
                {/* Status indicator */}
                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  {ollama.installed ? (
                    ollama.running ? (
                      <div className="flex items-center gap-2 bg-emerald-500/20 border border-emerald-500/30 rounded-full px-2 py-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-emerald-300 text-xs font-medium">Ollama Active</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 bg-amber-500/20 border border-amber-500/30 rounded-full px-2 py-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        <span className="text-amber-300 text-xs font-medium">Ollama Offline</span>
                      </div>
                    )
                  ) : (
                    <div className="flex items-center gap-2 bg-red-500/20 border border-red-500/30 rounded-full px-2 py-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                      <span className="text-red-300 text-xs font-medium">Not Installed</span>
                    </div>
                  )}

                  {/* Model status */}
                  {ollama.installed && ollama.running && (
                    <div className="text-slate-400 text-xs hidden sm:block">
                      {ollama.has_model ? (
                        <span className="flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-emerald-400" />
                          llama3.2:3b
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-amber-400" />
                          Model missing
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1">
                  {!ollama.installed && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-slate-600 hover:bg-slate-800 hover:text-slate-100 h-8 px-3 text-xs transition-all hover:border-slate-500 cursor-pointer"
                      onClick={handleOpenOllamaWebsite}
                    >
                      <ExternalLink className="w-3 h-3 mr-1" />
                      Install
                    </Button>
                  )}

                  {ollama.installed && !ollama.running && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="border-emerald-600/60 hover:bg-emerald-950/40 text-emerald-400 hover:text-emerald-300 hover:border-emerald-500/70 h-8 px-3 text-xs transition-all cursor-pointer"
                      onClick={handleStartOllama}
                    >
                      <Play className="w-3 h-3" />
                      Start
                    </Button>
                  )}

                  {ollama.installed && ollama.running && !ollama.has_model && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-slate-600 hover:bg-slate-800 hover:text-slate-100 h-8 px-3 text-xs transition-all hover:border-slate-500 cursor-pointer"
                      onClick={handlePullModel}
                    >
                      <Download className="w-3 h-3 mr-1" />
                      Download
                    </Button>
                  )}

                  {ollama.installed && ollama.running && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="border-red-600/60 hover:bg-red-950/40 text-red-400 hover:text-red-300 hover:border-red-500/70 h-8 px-3 text-xs transition-all cursor-pointer"
                      onClick={handleStopOllama}
                    >
                      <Square className="w-3 h-3" />
                      Stop
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 h-8 px-2 cursor-pointer"
                    onClick={loadOllamaStatus}
                  >
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="max-w-4xl mx-auto">
          {view === "home" ? (
            <Home />
          ) : (
            <div className="space-y-6">
              <AgentHeader />
              <AgentBody />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;