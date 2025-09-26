import { render } from 'ink';
import React from 'react';
import WorkspaceWizardApp from './app.js';
import type { WorkspaceWizardPlan } from '../../types/workspace.js';
import { readCommandHistory } from '../../services/history.js';

export async function launchWorkspaceWizardTui(initialPlan: WorkspaceWizardPlan): Promise<WorkspaceWizardPlan | null> {
  const history = readCommandHistory(50);
  let resolved = false;

  return new Promise((resolve) => {
    const app = render(
      <WorkspaceWizardApp
        initialPlan={initialPlan}
        history={history}
        onComplete={(plan) => {
          if (!resolved) {
            resolved = true;
            resolve(plan);
          }
        }}
        onCancel={() => {
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
        }}
      />,
    );

    app.waitUntilExit()
      .then(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      })
      .catch(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      });
  });
}
