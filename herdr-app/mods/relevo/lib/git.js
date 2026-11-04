// Reads that write nothing under .git (index refresh, lock, fsmonitor cookie), which a folder watch would wake on.
export const GIT_READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
