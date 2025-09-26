export type WorkspaceRemoteMode = 'skip' | 'url' | 'github';

export interface SetupFollowUpChoices {
  addUsers: boolean;
  addComponents: boolean;
  addLabels: boolean;
  authLogin: boolean;
  addRepos: boolean;
  newEpic: boolean;
  newStory: boolean;
  newSubtask: boolean;
  newSprint: boolean;
  planBacklog: boolean;
}

export const DEFAULT_FOLLOW_UP_CHOICES: SetupFollowUpChoices = {
  addUsers: true,
  addComponents: true,
  addLabels: true,
  authLogin: true,
  addRepos: true,
  newEpic: true,
  newStory: true,
  newSubtask: false,
  newSprint: true,
  planBacklog: true,
};

export interface WorkspaceWizardPlan {
  directory: string;
  allowOverwrite: boolean;
  initGit: boolean;
  remote: {
    mode: WorkspaceRemoteMode;
    url?: string;
    host?: string;
    account?: string;
    owner?: string;
    repo?: string;
    private?: boolean;
    push?: boolean | 'auto';
  };
  followUps: SetupFollowUpChoices;
  autoRunCommands: boolean;
}
