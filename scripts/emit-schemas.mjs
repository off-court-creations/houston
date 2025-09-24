import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.resolve(__dirname, '../schema');

const CANONICAL_TICKET_ID_PATTERN =
  '^(EPIC|ST|SB|BG)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const CANONICAL_PARENT_ID_PATTERN =
  '^(EPIC|ST)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const CANONICAL_EPIC_ID_PATTERN =
  '^EPIC-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const CANONICAL_STORY_ID_PATTERN =
  '^ST-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const CANONICAL_SUBTASK_ID_PATTERN =
  '^SB-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const CANONICAL_BUG_ID_PATTERN =
  '^BG-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const CANONICAL_WORK_ITEM_ID_PATTERN =
  '^(ST|SB|BG)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const CANONICAL_BRANCH_PATTERN =
  '^(epic|feat|task|fix)/(EPIC|ST|SB|BG)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}--[a-z0-9\\-]{1,32}$';
const CANONICAL_SPRINT_ID_PATTERN =
  '^S-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

fs.mkdirSync(schemaDir, { recursive: true });

const ticketBase = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://git-native-ticketing.example/schema/ticket.base.schema.json',
  title: 'Ticket (Base)',
  type: 'object',
  required: [
    'id',
    'type',
    'summary',
    'title',
    'assignee',
    'description',
    'components',
    'due_date',
    'status',
    'created_at',
    'updated_at',
    'version',
    'code',
  ],
  properties: {
    id: {
      type: 'string',
      pattern: CANONICAL_TICKET_ID_PATTERN,
    },
    type: {
      type: 'string',
      enum: ['epic', 'story', 'subtask', 'bug'],
    },
    summary: { $ref: '#/$defs/nonEmptyString' },
    title: { $ref: '#/$defs/nonEmptyString' },
    priority: {
      type: 'string',
      enum: ['P0', 'P1', 'P2', 'P3'],
    },
    assignee: { $ref: '#/$defs/userIdentifier' },
    description: { $ref: '#/$defs/relativeFilePath' },
    components: {
      type: 'array',
      minItems: 0,
      uniqueItems: true,
      items: { $ref: '#/$defs/nonEmptyString' },
    },
    labels: {
      type: 'array',
      uniqueItems: true,
      items: { $ref: '#/$defs/nonEmptyString' },
    },
    approvers: {
      type: 'array',
      uniqueItems: true,
      items: { $ref: '#/$defs/userIdentifier' },
    },
    due_date: {
      type: 'string',
      format: 'date',
    },
    status: {
      type: 'string',
      enum: ['Backlog', 'Planned', 'Ready', 'In Progress', 'Blocked', 'In Review', 'Done', 'Archived', 'Canceled'],
    },
    parent_id: {
      anyOf: [
        { type: 'null' },
        { type: 'string', pattern: CANONICAL_PARENT_ID_PATTERN },
      ],
    },
    sprint_id: {
      anyOf: [
        { type: 'null' },
        { type: 'string', pattern: CANONICAL_SPRINT_ID_PATTERN },
      ],
    },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1 },
    generated_by: { type: 'string', pattern: '^houston@[^\\s]+$' },
    acceptance_criteria: {
      type: 'array',
      items: { $ref: '#/$defs/nonEmptyString' },
    },
    definition_of_done: {
      type: 'array',
      items: { $ref: '#/$defs/nonEmptyString' },
    },
    story_points: { type: 'integer', minimum: 1 },
    time_tracking: {
      type: 'array',
      items: {
        type: 'object',
        required: ['date', 'by', 'minutes'],
        properties: {
          date: { type: 'string', format: 'date' },
          by: { $ref: '#/$defs/userIdentifier' },
          minutes: { type: 'integer', minimum: 1 },
          note: { $ref: '#/$defs/nonEmptyString' },
        },
        additionalProperties: false,
      },
    },
    code: {
      type: 'object',
      required: ['branch_strategy', 'auto_create_branch', 'auto_open_pr', 'repos'],
      properties: {
        branch_strategy: { type: 'string', enum: ['per-story', 'per-subtask', 'per-bug'] },
        auto_create_branch: { type: 'boolean' },
        auto_open_pr: { type: 'boolean' },
        repos: {
          type: 'array',
          items: { $ref: '#/$defs/codeRepositoryLink' },
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
  $defs: {
    nonEmptyString: { type: 'string', minLength: 1 },
    userIdentifier: { type: 'string', pattern: '^(user|bot):[a-z0-9_\\-]+$' },
    relativeFilePath: { type: 'string', pattern: '^(\\.\\./|\\./|[A-Za-z0-9])' },
    codeRepositoryLink: {
      type: 'object',
      required: ['repo_id', 'branch', 'created_by', 'created_at'],
      properties: {
        repo_id: { $ref: '#/$defs/nonEmptyString' },
        path: { $ref: '#/$defs/relativeFilePath' },
        branch: {
          type: 'string',
          pattern: CANONICAL_BRANCH_PATTERN,
        },
        created_by: { $ref: '#/$defs/userIdentifier' },
        created_at: { type: 'string', format: 'date-time' },
        pr: {
          type: 'object',
          required: ['base', 'head', 'state'],
          properties: {
            number: { type: 'integer', minimum: 1 },
            url: { type: 'string', format: 'uri' },
            base: { $ref: '#/$defs/nonEmptyString' },
            head: { $ref: '#/$defs/nonEmptyString' },
            state: { type: 'string', enum: ['open', 'merged', 'closed'] },
            reviewers: {
              type: 'array',
              uniqueItems: true,
              items: { $ref: '#/$defs/userIdentifier' },
            },
          },
          additionalProperties: false,
        },
        last_synced_at: { type: 'string', format: 'date-time' },
      },
      additionalProperties: false,
    },
  },
};

const ticketEpic = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://git-native-ticketing.example/schema/ticket.epic.schema.json',
  title: 'Ticket (Epic)',
  allOf: [
    { $ref: './ticket.base.schema.json' },
    {
      type: 'object',
      properties: {
        type: { const: 'epic' },
      },
      not: { anyOf: [{ required: ['priority'] }, { required: ['story_points'] }, { required: ['time_tracking'] }] },
    },
  ],
};

const ticketStory = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://git-native-ticketing.example/schema/ticket.story.schema.json',
  title: 'Ticket (Story)',
  allOf: [
    { $ref: './ticket.base.schema.json' },
    {
      type: 'object',
      properties: {
        type: { const: 'story' },
        parent_id: {
          anyOf: [
            { type: 'null' },
            { type: 'string', pattern: CANONICAL_EPIC_ID_PATTERN },
          ],
        },
      },
      not: { required: ['time_tracking'] },
    },
  ],
};

const ticketSubtask = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://git-native-ticketing.example/schema/ticket.subtask.schema.json',
  title: 'Ticket (Subtask)',
  allOf: [
    { $ref: './ticket.base.schema.json' },
    {
      type: 'object',
      properties: {
        type: { const: 'subtask' },
        parent_id: { type: 'string', pattern: CANONICAL_STORY_ID_PATTERN },
      },
      required: ['parent_id', 'story_points'],
      not: { required: ['time_tracking'] },
    },
  ],
};

const ticketBug = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://git-native-ticketing.example/schema/ticket.bug.schema.json',
  title: 'Ticket (Bug)',
  allOf: [
    { $ref: './ticket.base.schema.json' },
    {
      type: 'object',
      properties: {
        type: { const: 'bug' },
        parent_id: {
          anyOf: [
            { type: 'null' },
            { type: 'string', pattern: CANONICAL_STORY_ID_PATTERN },
          ],
        },
      },
      required: ['story_points', 'time_tracking'],
    },
  ],
};

const sprint = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://git-native-ticketing.example/schema/sprint.schema.json',
  title: 'Sprint Metadata',
  type: 'object',
  required: ['id', 'name', 'start_date', 'end_date'],
  properties: {
    id: { type: 'string', pattern: CANONICAL_SPRINT_ID_PATTERN },
    name: { type: 'string', minLength: 1 },
    start_date: { type: 'string', format: 'date' },
    end_date: { type: 'string', format: 'date' },
    goal: { type: 'string' },
    team_capacity: {
      type: 'object',
      propertyNames: { pattern: '^user:[a-z0-9_\\-]+$' },
      additionalProperties: { type: 'string', pattern: '^\\d+(?:\\.\\d+)?h$' },
    },
    burndown_source: { type: 'string', pattern: '^(\\.\\./|\\./|[A-Za-z0-9])' },
    notes: { type: 'string' },
    generated_by: { type: 'string', pattern: '^houston@[^\\s]+$' },
  },
  additionalProperties: false,
};

const sprintScope = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://git-native-ticketing.example/schema/sprint.scope.schema.json',
  title: 'Sprint Scope',
  type: 'object',
  properties: {
    epics: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', pattern: CANONICAL_EPIC_ID_PATTERN },
    },
    stories: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', pattern: CANONICAL_STORY_ID_PATTERN },
    },
    subtasks: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', pattern: CANONICAL_SUBTASK_ID_PATTERN },
    },
    bugs: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', pattern: CANONICAL_BUG_ID_PATTERN },
    },
    generated_by: { type: 'string', pattern: '^houston@[^\\s]+$' },
  },
  additionalProperties: false,
};

const backlog = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://git-native-ticketing.example/schema/backlog.schema.json',
  title: 'Backlog Lists',
  oneOf: [
    {
      type: 'object',
      required: ['ordered'],
      properties: {
        ordered: { type: 'array', items: { $ref: '#/$defs/backlogTicketId' } },
        notes: { type: 'string' },
        generated_by: { type: 'string', pattern: '^houston@[^\\s]+$' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['candidates'],
      properties: {
        candidates: { type: 'array', items: { $ref: '#/$defs/backlogTicketId' } },
        notes: { type: 'string' },
        generated_by: { type: 'string', pattern: '^houston@[^\\s]+$' },
      },
      additionalProperties: false,
    },
  ],
  $defs: {
    backlogTicketId: { type: 'string', pattern: CANONICAL_WORK_ITEM_ID_PATTERN },
  },
};

const repos = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://git-native-ticketing.example/schema/repos.schema.json',
  title: 'Registered Code Repositories',
  type: 'object',
  required: ['repos'],
  properties: {
    repos: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'provider', 'default_branch'],
        properties: {
          id: { type: 'string', minLength: 1 },
          provider: { type: 'string', enum: ['github', 'gitlab', 'bitbucket', 'local'] },
          remote: { type: 'string', minLength: 1 },
          default_branch: { type: 'string', minLength: 1 },
          branch_prefix: {
            type: 'object',
            required: ['epic', 'story', 'subtask', 'bug'],
            properties: {
              epic: { $ref: '#/$defs/branchPrefix' },
              story: { $ref: '#/$defs/branchPrefix' },
              subtask: { $ref: '#/$defs/branchPrefix' },
              bug: { $ref: '#/$defs/branchPrefix' },
            },
            additionalProperties: false,
          },
          pr: {
            type: 'object',
            properties: {
              open_by_default: { type: 'boolean' },
              base: { type: 'string', minLength: 1 },
              labels: {
                type: 'array',
                uniqueItems: true,
                items: { type: 'string', minLength: 1 },
              },
              reviewers_from_ticket_approvers: { type: 'boolean' },
            },
            additionalProperties: false,
          },
          protections: {
            type: 'object',
            properties: {
              require_status_checks: { type: 'boolean' },
              disallow_force_push: { type: 'boolean' },
            },
            additionalProperties: false,
          },
          generated_by: { type: 'string', pattern: '^houston@[^\\s]+$' },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
  $defs: {
    branchPrefix: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]*$' },
  },
};

const componentRouting = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://git-native-ticketing.example/schema/component-routing.schema.json',
  title: 'Component Routing',
  type: 'object',
  required: ['routes'],
  properties: {
    routes: {
      type: 'object',
      propertyNames: { pattern: '^[a-z0-9][a-z0-9_-]*$' },
      additionalProperties: {
        type: 'array',
        minItems: 1,
        uniqueItems: true,
        items: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]*(?:@[A-Za-z0-9./_-]+)?$' },
      },
    },
    defaults: {
      type: 'object',
      properties: {
        epic: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]*(?:@[A-Za-z0-9./_-]+)?$' } },
        story: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]*(?:@[A-Za-z0-9./_-]+)?$' } },
        subtask: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]*(?:@[A-Za-z0-9./_-]+)?$' } },
        bug: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]*(?:@[A-Za-z0-9./_-]+)?$' } },
      },
      additionalProperties: false,
    },
    generated_by: { type: 'string', pattern: '^houston@[^\\s]+$' },
  },
  additionalProperties: false,
};

const transitions = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://git-native-ticketing.example/schema/transitions.schema.json',
  title: 'Ticket Status Transitions',
  type: 'object',
  required: ['allowed'],
  properties: {
    allowed: {
      type: 'object',
      required: ['epic', 'story', 'subtask', 'bug'],
      properties: {
        epic: { $ref: '#/$defs/typeTransitions' },
        story: { $ref: '#/$defs/typeTransitions' },
        subtask: { $ref: '#/$defs/typeTransitions' },
        bug: { $ref: '#/$defs/typeTransitions' },
      },
      additionalProperties: false,
    },
    generated_by: { type: 'string', pattern: '^houston@[^\\s]+$' },
  },
  additionalProperties: false,
  $defs: {
    status: {
      type: 'string',
      enum: ['Backlog', 'Planned', 'Ready', 'In Progress', 'Blocked', 'In Review', 'Done', 'Archived', 'Canceled'],
    },
    typeTransitions: {
      type: 'object',
      propertyNames: { $ref: '#/$defs/status' },
      additionalProperties: {
        type: 'array',
        uniqueItems: true,
        items: { $ref: '#/$defs/status' },
      },
    },
  },
};

const schemas = {
  'ticket.base.schema.json': ticketBase,
  'ticket.epic.schema.json': ticketEpic,
  'ticket.story.schema.json': ticketStory,
  'ticket.subtask.schema.json': ticketSubtask,
  'ticket.bug.schema.json': ticketBug,
  'sprint.schema.json': sprint,
  'sprint.scope.schema.json': sprintScope,
  'backlog.schema.json': backlog,
  'repos.schema.json': repos,
  'component-routing.schema.json': componentRouting,
  'transitions.schema.json': transitions,
};

for (const [fileName, json] of Object.entries(schemas)) {
  const dest = path.join(schemaDir, fileName);
  fs.writeFileSync(dest, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
}
