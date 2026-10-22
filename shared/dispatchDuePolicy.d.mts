import type { DispatchTask, UserProfile } from './types';
export function canEditDispatchDue(task: Pick<DispatchTask, 'shopId' | 'stage' | 'orderStatus' | 'needsReview'> | undefined, actor: UserProfile | undefined): boolean;
