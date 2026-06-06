import React, { useMemo, useState } from "react";
import type { Project, ProjectSettings } from "@openreel/core";
import { FolderOpen, Languages, Plus, Video } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import type { AppRoute } from "../../hooks/use-router";
import { useI18n } from "../../i18n";

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
  const { language, setLanguage, t } = useI18n();
  const createNewProject = useProjectStore((state) => state.createNewProject);
  const loadProject = useProjectStore((state) => state.loadProject);
  const [projectName, setProjectName] = useState(() => t("welcome.defaultProjectName"));
  const [recentProjects, setRecentProjects] = useState<StoredProject[]>(() => readStoredProjects());

  const presets = useMemo(() => [
    { label: t("welcome.landscape"), width: 1920, height: 1080 },
    { label: t("welcome.portrait"), width: 1080, height: 1920 },
    { label: t("welcome.square"), width: 1080, height: 1080 },
  ], [t]);

  const startNewProject = (settings: Partial<ProjectSettings>) => {
    createNewProject(projectName.trim() || t("welcome.defaultProjectName"), {
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
        <header className="mb-10 flex items-start justify-between gap-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Video className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">{t("welcome.title")}</h1>
              <p className="text-sm text-text-secondary">
                {t("welcome.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
            title={t("welcome.language")}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background-secondary px-3 py-2 text-sm text-text-secondary transition hover:border-primary hover:text-text-primary"
          >
            <Languages className="h-4 w-4" />
            {language === "zh" ? "中文" : "English"}
          </button>
        </header>

        <main className="grid gap-6 lg:grid-cols-[1fr_420px]">
          <section className="rounded-2xl border border-border bg-background-secondary p-6">
            <div className="mb-5 flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-medium">{t("welcome.newProject")}</h2>
            </div>
            <label className="mb-4 block text-sm text-text-secondary">
              {t("welcome.projectName")}
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
              <h2 className="text-lg font-medium">{t("welcome.recentProjects")}</h2>
            </div>
            {recentProjects.length === 0 ? (
              <p className="text-sm text-text-secondary">{t("welcome.noRecentProjects")}</p>
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
