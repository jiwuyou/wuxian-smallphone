const { createDefaultPromptBoardModulesV1 } = require("../shared/prompt-board");

const CONTACT_WORKFLOWS = [
  {
    id: "smallphone.default.contact",
    version: 1,
    name: "Default Contact",
    description: "Default SmallPhone 1:1 contact workflow (workspace + contact persona + user persona).",
    promptBoardDefaults: {
      version: 1,
      modules: createDefaultPromptBoardModulesV1(),
    },
    contactConfigSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        contactProjectDir: {
          type: "string",
          ui: "path",
          minLength: 1,
          title: "Contact Project Dir",
          description: "Workspace directory for this contact/thread runtime (maps to thread.runtime.workspaceDir).",
        },
        contactPersona: {
          type: "string",
          ui: "textarea",
          format: "textarea",
          minLength: 1,
          title: "Contact Persona",
          description: "Persona/system prompt for the contact character (maps to character.persona).",
        },
        userPersona: {
          type: "string",
          ui: "textarea",
          format: "textarea",
          minLength: 1,
          title: "User Persona",
          description: "User-side persona/context (stored in workflowInput and injected into runtime prompt).",
        },
      },
      required: ["contactProjectDir", "contactPersona", "userPersona"],
    },
    rules: [
      {
        id: "materialize.thread.runtime.workspaceDir",
        when: "create_or_update_companion",
        from: "workflowInput.contactProjectDir",
        to: "thread.runtime.workspaceDir",
      },
      {
        id: "materialize.character.persona",
        when: "create_or_update_companion",
        from: "workflowInput.contactPersona",
        to: "character.persona",
      },
      {
        id: "inject.userPersona",
        when: "runtime.prompt",
        from: "workflowInput.userPersona",
        to: "runtime.prompt",
      },
    ],
    inputSources: [
      { id: "manual", type: "manual", label: "Manual config" },
      { id: "project-dir", type: "filesystem", key: "contactProjectDir" },
    ],
  },
  {
    id: "smallphone.task.agent",
    version: 1,
    name: "Task Agent",
    description: "Workflow for a task-focused agent contact (still requires workspace + personas).",
    promptBoardDefaults: {
      version: 1,
      modules: createDefaultPromptBoardModulesV1(),
    },
    contactConfigSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        contactProjectDir: {
          type: "string",
          ui: "path",
          minLength: 1,
          title: "Task Project Dir",
          description: "Workspace directory for this task agent (maps to thread.runtime.workspaceDir).",
        },
        contactPersona: {
          type: "string",
          ui: "textarea",
          format: "textarea",
          minLength: 1,
          title: "Agent Persona",
          description: "Persona/system prompt for the task agent (maps to character.persona).",
        },
        userPersona: {
          type: "string",
          ui: "textarea",
          format: "textarea",
          minLength: 1,
          title: "User Persona",
          description: "User-side persona/context (stored in workflowInput and injected into runtime prompt).",
        },
      },
      required: ["contactProjectDir", "contactPersona", "userPersona"],
    },
    rules: [
      {
        id: "materialize.thread.runtime.workspaceDir",
        when: "create_or_update_companion",
        from: "workflowInput.contactProjectDir",
        to: "thread.runtime.workspaceDir",
      },
      {
        id: "materialize.character.persona",
        when: "create_or_update_companion",
        from: "workflowInput.contactPersona",
        to: "character.persona",
      },
      {
        id: "inject.userPersona",
        when: "runtime.prompt",
        from: "workflowInput.userPersona",
        to: "runtime.prompt",
      },
    ],
    inputSources: [{ id: "manual", type: "manual", label: "Manual config" }],
  },
];

function listContactWorkflows() {
  return CONTACT_WORKFLOWS.map((workflow) => structuredClone(workflow));
}

function listWorkflows() {
  // For now, all workflows are contact workflows.
  return listContactWorkflows();
}

function getWorkflowDefinition(workflowId, workflowVersion) {
  const id = String(workflowId || "").trim();
  const version = Number.isFinite(Number(workflowVersion)) ? Number(workflowVersion) : Number.NaN;
  if (!id || !Number.isFinite(version)) {
    return null;
  }
  const found = CONTACT_WORKFLOWS.find((wf) => wf.id === id && wf.version === version) || null;
  return found ? structuredClone(found) : null;
}

module.exports = {
  listWorkflows,
  listContactWorkflows,
  getWorkflowDefinition,
};
