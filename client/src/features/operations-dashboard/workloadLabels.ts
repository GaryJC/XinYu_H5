import type { WorkloadState } from "../../../../shared/types";

export const workloadLabels:Record<WorkloadState,string>={working:'维修中',waiting:'未开工',paused:'暂停',inspection:'待检验',unfinished:'全部未完成'};
