import React, { useMemo, useState } from 'react';
import path from 'node:path';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import type { WorkspaceWizardPlan, SetupFollowUpChoices } from '../../types/workspace.js';
import type { CommandHistoryEntry } from '../../services/history.js';
import { CoachingTip, getCoachingTips } from '../../services/doc-coach.js';
import { hasMeaningfulEntries } from '../../services/workspace-files.js';
import { DEFAULT_FOLLOW_UP_CHOICES } from '../../types/workspace.js';

const STEPS: WizardStepId[] = ['directory', 'git', 'remote', 'followups', 'summary'];

type WizardStepId = 'directory' | 'git' | 'remote' | 'followups' | 'summary';

type WorkspaceWizardAppProps = {
  initialPlan: WorkspaceWizardPlan;
  history: CommandHistoryEntry[];
  onComplete: (plan: WorkspaceWizardPlan) => void;
  onCancel: () => void;
};

type StepProps = {
  plan: WorkspaceWizardPlan;
  tips: CoachingTip[];
  stepIndex: number;
  totalSteps: number;
  onNext: (updates: Partial<WorkspaceWizardPlan>) => void;
  onBack: () => void;
  onCancel: () => void;
};

const FOLLOW_UP_LABELS: Record<keyof SetupFollowUpChoices, string> = {
  addUsers: 'Add users',
  addComponents: 'Add components',
  addLabels: 'Add labels',
  authLogin: 'GitHub auth login',
  addRepos: 'Add repositories',
  newEpic: 'Create first epic',
  newStory: 'Create first story',
  newSubtask: 'Create first subtask',
  newSprint: 'Create first sprint',
  planBacklog: 'Run backlog planning',
};

const WorkspaceWizardApp: React.FC<WorkspaceWizardAppProps> = ({ initialPlan, history, onComplete, onCancel }) => {
  const { exit } = useApp();
  const [plan, setPlan] = useState<WorkspaceWizardPlan>({
    ...initialPlan,
    followUps: initialPlan.followUps ?? { ...DEFAULT_FOLLOW_UP_CHOICES },
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [completed, setCompleted] = useState(false);

  const step = STEPS[stepIndex];
  const tips = useMemo(() => getCoachingTips(step, history), [step, history]);

  const goToNext = (updates: Partial<WorkspaceWizardPlan>) => {
    setPlan((prev) => ({ ...prev, ...updates }));
    setStepIndex((prev) => Math.min(STEPS.length - 1, prev + 1));
  };

  const goBack = () => {
    setStepIndex((prev) => (prev === 0 ? 0 : prev - 1));
  };

  const handleCancel = () => {
    if (completed) return;
    setCompleted(true);
    onCancel();
    exit();
  };

  const handleComplete = (finalPlan: WorkspaceWizardPlan) => {
    if (completed) return;
    setCompleted(true);
    onComplete(finalPlan);
    exit();
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      handleCancel();
    }
  });

  if (completed) {
    return (
      <StepLayout title="Exiting" stepIndex={stepIndex} totalSteps={STEPS.length} tips={[]}>
        <Text>Closing wizard…</Text>
      </StepLayout>
    );
  }

  switch (step) {
    case 'directory':
      return (
        <DirectoryStep
          plan={plan}
          tips={tips}
          stepIndex={stepIndex}
          totalSteps={STEPS.length}
          onNext={(updates) => goToNext(updates)}
          onBack={handleCancel}
          onCancel={handleCancel}
        />
      );
    case 'git':
      return (
        <GitStep
          plan={plan}
          tips={tips}
          stepIndex={stepIndex}
          totalSteps={STEPS.length}
          onNext={(updates) => goToNext(updates)}
          onBack={goBack}
          onCancel={handleCancel}
        />
      );
   case 'remote':
      return (
        <RemoteStep
          plan={plan}
          tips={tips}
          stepIndex={stepIndex}
          totalSteps={STEPS.length}
          onNext={(updates) => goToNext(updates)}
          onBack={goBack}
          onCancel={handleCancel}
        />
      );
    case 'followups':
      return (
        <FollowupsStep
          plan={plan}
          tips={tips}
          stepIndex={stepIndex}
          totalSteps={STEPS.length}
          onNext={(updates) => goToNext(updates)}
          onBack={goBack}
          onCancel={handleCancel}
        />
      );
    case 'summary':
    default:
      return (
        <SummaryStep
          plan={plan}
          tips={tips}
          stepIndex={stepIndex}
          totalSteps={STEPS.length}
          onNext={(updates) => setPlan((prev) => ({ ...prev, ...updates }))}
          onBack={goBack}
          onCancel={handleCancel}
          onComplete={() => handleComplete(plan)}
        />
      );
  }
};

const StepLayout: React.FC<{ title: string; tips: CoachingTip[]; stepIndex: number; totalSteps: number; children: React.ReactNode }> = ({
  title,
  tips,
  stepIndex,
  totalSteps,
  children,
}) => (
  <Box flexDirection="column" paddingX={1} paddingY={1}>
    <Box marginBottom={1} flexDirection="column">
      <Text color="cyan">Step {stepIndex + 1} of {totalSteps}</Text>
      <Text>{title}</Text>
    </Box>
    <Box flexDirection="row">
      <Box flexGrow={1} flexDirection="column">
        {children}
      </Box>
      <Box flexDirection="column" width={40} marginLeft={2}>
        <Text color="magenta">Coach</Text>
        {tips.length === 0 ? (
          <Text dimColor>No contextual tips.</Text>
        ) : (
          tips.map((tip, idx) => (
            <Box key={`${tip.title}-${idx}`} flexDirection="column" marginTop={1}>
              <Text color="magentaBright">• {tip.title}</Text>
              <Text dimColor>{truncate(tip.detail)}</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  </Box>
);

const DirectoryStep: React.FC<StepProps> = ({ plan, tips, stepIndex, totalSteps, onNext, onCancel }) => {
  const [value, setValue] = useState(makeDisplayPath(plan.directory));
  const [overwrite, setOverwrite] = useState(plan.allowOverwrite ?? false);
  const [pending, setPending] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const handleSubmit = (input: string) => {
    const safeInput = input.trim() === '' ? '.' : input.trim();
    const resolved = path.resolve(process.cwd(), safeInput);
    if (hasMeaningfulEntries(resolved) && !overwrite) {
      setWarning(`Directory ${resolved} is not empty. Press y to overwrite or edit the path.`);
      setPending(resolved);
      return;
    }
    onNext({ directory: resolved, allowOverwrite: overwrite });
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    }
    if (input.toLowerCase() === 'o' && key.shift) {
      setOverwrite((prev) => !prev);
    }
    if (pending) {
      if (input.toLowerCase() === 'y') {
        onNext({ directory: pending, allowOverwrite: true });
      }
      if (input.toLowerCase() === 'n') {
        setPending(null);
        setWarning(null);
      }
    }
  });

  return (
    <StepLayout title="Workspace directory" tips={tips} stepIndex={stepIndex} totalSteps={totalSteps}>
      <Box flexDirection="column">
        <Text>Directory path</Text>
        <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
        <Text dimColor>Press Shift+O to toggle overwrite ({overwrite ? 'ON' : 'OFF'}). Esc cancels.</Text>
        {warning ? <Text color="yellow">{warning}</Text> : null}
      </Box>
    </StepLayout>
  );
};

const GitStep: React.FC<StepProps> = ({ plan, tips, stepIndex, totalSteps, onNext, onBack, onCancel }) => (
  <StepLayout title="Git initialization" tips={tips} stepIndex={stepIndex} totalSteps={totalSteps}>
    <SelectInput
      items={[
        { label: 'Initialize git repository (recommended)', value: 'init' },
        { label: 'Skip git initialization', value: 'skip' },
        { label: 'Back', value: 'back' },
        { label: 'Cancel', value: 'cancel' },
      ]}
      initialIndex={plan.initGit ? 0 : 1}
      onSelect={(item) => {
        if (item.value === 'back') {
          onBack();
          return;
        }
        if (item.value === 'cancel') {
          onCancel();
          return;
        }
        onNext({ initGit: item.value === 'init' });
      }}
    />
    <Text dimColor>Use arrows and Enter.</Text>
  </StepLayout>
);

const RemoteStep: React.FC<StepProps> = ({ plan, tips, stepIndex, totalSteps, onNext, onBack, onCancel }) => {
  const [mode, setMode] = useState<WorkspaceWizardPlan['remote']['mode']>(plan.remote?.mode ?? 'skip');
  const [url, setUrl] = useState(plan.remote?.mode === 'url' ? plan.remote.url ?? '' : '');
  const [host, setHost] = useState(plan.remote?.mode === 'github' ? plan.remote.host ?? 'github.com' : 'github.com');
  const [owner, setOwner] = useState(plan.remote?.mode === 'github' ? plan.remote.owner ?? '' : '');
  const [repo, setRepo] = useState(plan.remote?.mode === 'github' ? plan.remote.repo ?? '' : '');
  const [isPrivate, setIsPrivate] = useState(plan.remote?.mode === 'github' ? plan.remote.private !== false : true);
  const [pushChoice, setPushChoice] = useState<WorkspaceWizardPlan['remote']['push']>(
    plan.remote?.push === undefined ? 'auto' : plan.remote.push,
  );

  const submitRemote = (remote: WorkspaceWizardPlan['remote']) => {
    onNext({ remote } as Partial<WorkspaceWizardPlan>);
    setMode('skip');
  };

  const handleModeSelect = (selected: WorkspaceWizardPlan['remote']['mode'] | 'back' | 'cancel') => {
    if (selected === 'back') {
      onBack();
      return;
    }
    if (selected === 'cancel') {
      onCancel();
      return;
    }
    setMode(selected);
    if (selected === 'skip') {
      submitRemote({ mode: 'skip', push: pushChoice });
    }
  };

  if (mode === 'skip') {
    return (
      <StepLayout title="Remote configuration" tips={tips} stepIndex={stepIndex} totalSteps={totalSteps}>
        <SelectInput
          items={[
            { label: 'Skip remote for now', value: 'skip' },
            { label: 'Use existing remote URL', value: 'url' },
            { label: 'Create GitHub repository', value: 'github' },
            { label: 'Back', value: 'back' },
            { label: 'Cancel', value: 'cancel' },
          ]}
          initialIndex={0}
          onSelect={(item) => handleModeSelect(item.value as any)}
        />
        <Text dimColor>You can add a remote later with `houston repo add`.</Text>
      </StepLayout>
    );
  }

  if (mode === 'url') {
    const trimmedUrl = url.trim();
    return (
      <StepLayout title="Remote URL" tips={tips} stepIndex={stepIndex} totalSteps={totalSteps}>
        <Text>Remote URL (ssh/https)</Text>
        <TextInput value={url} onChange={setUrl} onSubmit={(value) => setUrl(value.trim())} />
        <Text dimColor>Enter the git remote URL and press Enter.</Text>
        <SelectInput
          items={[
            { label: 'Push initial commit now', value: 'push-now' },
            { label: 'Skip push for now', value: 'push-later' },
            { label: 'Back', value: 'back' },
          ]}
          onSelect={(item) => {
            if (item.value === 'back') {
              setMode('skip');
              return;
            }
            if (!trimmedUrl) {
              return;
            }
            const shouldPush = item.value === 'push-now';
            setPushChoice(shouldPush);
            submitRemote({ mode: 'url', url: trimmedUrl, push: shouldPush });
          }}
        />
      </StepLayout>
    );
  }

  // GitHub
  return (
    <StepLayout title="GitHub remote" tips={tips} stepIndex={stepIndex} totalSteps={totalSteps}>
      <Box flexDirection="column">
        <Text>GitHub host</Text>
        <TextInput value={host} onChange={setHost} />
        <Text>Repository owner</Text>
        <TextInput value={owner} onChange={setOwner} />
        <Text>Repository name</Text>
        <TextInput value={repo} onChange={setRepo} />
        <SelectInput
          items={[
            { label: 'Private repository', value: 'private' },
            { label: 'Public repository', value: 'public' },
          ]}
          initialIndex={isPrivate ? 0 : 1}
          onSelect={(item) => setIsPrivate(item.value === 'private')}
        />
        <SelectInput
          items={[
            { label: 'Push initial commit now', value: 'push-now' },
            { label: 'Skip push for now', value: 'push-later' },
            { label: 'Back', value: 'back' },
          ]}
          onSelect={(item) => {
            if (item.value === 'back') {
              setMode('skip');
              return;
            }
            const ownerTrimmed = owner.trim();
            const repoTrimmed = repo.trim();
            if (!ownerTrimmed || !repoTrimmed) {
              return;
            }
            const shouldPush = item.value === 'push-now';
            setPushChoice(shouldPush);
            submitRemote({
              mode: 'github',
              host: host.trim() || 'github.com',
              owner: ownerTrimmed,
              repo: repoTrimmed,
              private: isPrivate,
              push: shouldPush,
            });
          }}
        />
        <Text dimColor>Run `houston auth login github` beforehand to let Houston create the repo.</Text>
      </Box>
    </StepLayout>
  );
};

const FollowupsStep: React.FC<StepProps> = ({ plan, tips, stepIndex, totalSteps, onNext, onBack, onCancel }) => {
  const [choices, setChoices] = useState<SetupFollowUpChoices>({ ...plan.followUps });
  const items = Object.entries(FOLLOW_UP_LABELS).map(([key, label]) => ({
    label: `${choices[key as keyof SetupFollowUpChoices] ? '☑' : '☐'} ${label}`,
    value: `toggle:${key}`,
  }));
  items.push({ label: 'Continue', value: 'continue' });
  items.push({ label: 'Back', value: 'back' });
  items.push({ label: 'Cancel', value: 'cancel' });

  return (
    <StepLayout title="Follow-up actions" tips={tips} stepIndex={stepIndex} totalSteps={totalSteps}>
      <SelectInput
        items={items}
        onSelect={(item) => {
          if (item.value === 'continue') {
            onNext({ followUps: choices } as Partial<WorkspaceWizardPlan>);
            return;
          }
          if (item.value === 'back') {
            onBack();
            return;
          }
          if (item.value === 'cancel') {
            onCancel();
            return;
          }
          const [, key] = item.value.split(':');
          const typedKey = key as keyof SetupFollowUpChoices;
          setChoices((prev) => ({ ...prev, [typedKey]: !prev[typedKey] }));
        }}
      />
      <Text dimColor>Toggle items, then select Continue.</Text>
    </StepLayout>
  );
};

const SummaryStep: React.FC<StepProps & { onComplete: () => void }> = ({ plan, tips, stepIndex, totalSteps, onNext, onBack, onCancel, onComplete }) => {
  const rows = buildSummary(plan);
  const items = [
    { label: 'Confirm and scaffold workspace', value: 'confirm' },
    { label: plan.autoRunCommands ? 'Auto-run follow-up commands: ON' : 'Auto-run follow-up commands: OFF', value: 'toggle-auto' },
    { label: 'Back', value: 'back' },
    { label: 'Cancel', value: 'cancel' },
  ];

  return (
    <StepLayout title="Review" tips={tips} stepIndex={stepIndex} totalSteps={totalSteps}>
      <Box flexDirection="column">
        {rows.map(([label, value]) => (
          <Text key={label}>
            <Text color="cyan">{label}: </Text>
            {value}
          </Text>
        ))}
      </Box>
      <SelectInput
        items={items}
        onSelect={(item) => {
          if (item.value === 'confirm') {
            onComplete();
            return;
          }
          if (item.value === 'toggle-auto') {
            onNext({ autoRunCommands: !plan.autoRunCommands });
            return;
          }
          if (item.value === 'back') {
            onBack();
            return;
          }
          onCancel();
        }}
      />
      <Text dimColor>Confirm or adjust settings.</Text>
    </StepLayout>
  );
};

function makeDisplayPath(absPath: string): string {
  const relative = path.relative(process.cwd(), absPath);
  return relative === '' ? '.' : relative;
}

function truncate(text: string, max = 90): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function buildSummary(plan: WorkspaceWizardPlan): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  rows.push(['Directory', plan.directory]);
  rows.push(['Overwrite existing files', plan.allowOverwrite ? 'yes' : 'no']);
  rows.push(['Git', plan.initGit ? 'initialize repository' : 'skip git']);
  if (plan.remote?.mode === 'skip' || !plan.remote) {
    rows.push(['Remote', 'not configured']);
  } else if (plan.remote.mode === 'url') {
    rows.push(['Remote', plan.remote.url ?? '']);
  } else if (plan.remote.mode === 'github') {
    rows.push(['Remote', `${plan.remote.host ?? 'github.com'}/${plan.remote.owner ?? '?'} → ${plan.remote.repo ?? '?'}`]);
    rows.push(['Visibility', plan.remote.private === false ? 'public' : 'private']);
  }
  rows.push(['Auto-run follow-ups', plan.autoRunCommands ? 'yes' : 'no']);
  return rows;
}

export default WorkspaceWizardApp;
