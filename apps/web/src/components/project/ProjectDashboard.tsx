import React, { useMemo, useState } from "react";
import type { Project, ProjectSettings } from "@openreel/core";
import { FolderOpen, Plus, Video } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import type { AppRoute } from "../../hooks/use-router";

const RECENT_PROJECTS_KEY = "or-animspeaker:recent-projects";

interface StoredProject {
  id: string;
  name: string;
  updatedAt: number;
  settings: ProjectSettings;
  project: Project;
}

export function rememberProject(project: Project): void {
  try {
    const existing = readStoredProjects();
    const sanitized = sanitizeProject(project);
    const next = [
      {
        id: sanitized.id,
        name: sanitized.name,
        updatedAt: Date.now(),
        settings: sanitized.settings,
        project: sanitized,
      },
      ...existing.filter((item) => item.id !== project.id),
    ].slice(0, 12);
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("[ProjectDashboard] Failed to remember project", error);
  }
}

const readStoredProjects = (): StoredProject[] => {
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_KEY);
    return raw ? JSON.parse(raw) as StoredProject[] : [];
  } catch {
    return [];
  }
};

const sanitizeProject = (project: Project): Project => ({
  ...project,
  mediaLibrary: {
    ...project.mediaLibrary,
    items: project.mediaLibrary.items.map((item) => ({
      ...item,
      blob: null,
      fileHandle: null,
      waveformData: null,
      thumbnailUrl: item.thumbnailUrl?.startsWith("blob:") ? null : item.thumbnailUrl,
      filmstripThumbnails: undefined,
      isPlaceholder: item.blob ? true : item.isPlaceholder,
    })),
  },
});

export const ProjectDashboard: React.FC<{
  navigate: (route: AppRoute) => void;
}> = ({ navigate }) => {
  const createNewProject = useProjectStore((state) => state.createNewProject);
  const loadProject = useProjectStore((state) => state.loadProject);
  const [projectName, setProjectName] = useState("角色视频项目");
  const [recentProjects, setRecentProjects] = useState<StoredProject[]>(() => readStoredProjects());

  const presets = useMemo(() => [
    { label: "横屏 1920 x 1080", width: 1920, height: 1080 },
    { label: "竖屏 1080 x 1920", width: 1080, height: 1920 },
    { label: "方形 1080 x 1080", width: 1080, height: 1080 },
  ], []);

  const startNewProject = (settings: Partial<ProjectSettings>) => {
    createNewProject(projectName.trim() || "角色视频项目", {
      width: settings.width,
      height: settings.height,
      frameRate: 30,
    });
    const project = useProjectStore.getState().project;
    rememberProject(project);
    setRecentProjects(readStoredProjects());
    navigate("editor");
  };

  const openProject = (stored: StoredProject) => {
    loadProject(stored.project);
    rememberProject(stored.project);
    navigate("editor");
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-background text-text-primary">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col px-8 py-10">
        <header className="mb-10">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Video className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">角色视频编辑器</h1>
              <p className="text-sm text-text-secondary">
                ORAnimSpeaker 项目管理和角色动画生成工作流。
              </p>
            </div>
          </div>
        </header>

        <main className="grid gap-6 lg:grid-cols-[1fr_420px]">
          <section className="rounded-2xl border border-border bg-background-secondary p-6">
            <div className="mb-5 flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-medium">新建项目</h2>
            </div>
            <label className="mb-4 block text-sm text-text-secondary">
              项目名称
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-text-primary"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  className="rounded-xl border border-border bg-background p-4 text-left transition hover:border-primary"
                  onClick={() => startNewProject(preset)}
                >
                  <div className="text-sm font-medium">{preset.label}</div>
                  <div className="mt-2 text-xs text-text-secondary">30 fps</div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-background-secondary p-6">
            <div className="mb-5 flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-medium">最近项目</h2>
            </div>
            {recentProjects.length === 0 ? (
              <p className="text-sm text-text-secondary">还没有最近项目。新建项目后会显示在这里。</p>
            ) : (
              <div className="space-y-3">
                {recentProjects.map((project) => (
                  <button
                    key={project.id}
                    className="w-full rounded-xl border border-border bg-background p-3 text-left transition hover:border-primary"
                    onClick={() => openProject(project)}
                  >
                    <div className="text-sm font-medium">{project.name}</div>
                    <div className="mt-1 text-xs text-text-secondary">
                      {project.settings.width} x {project.settings.height} · {new Date(project.updatedAt).toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
};

export default ProjectDashboard;
