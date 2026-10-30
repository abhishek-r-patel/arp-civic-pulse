// Dependency-free diagrams with text alternatives; no remote diagram service receives source data.
export function FlowDiagram({
  title,
  steps,
}: Readonly<{ title: string; steps: readonly (readonly [string, string])[] }>) {
  return (
    <figure className="grid gap-3 rounded-control border border-border bg-surface p-4">
      <figcaption className="font-semibold text-primary">{title}</figcaption>
      <ol className="grid gap-3">
        {steps.map(([label, detail], index) => (
          <li key={label} className="flex min-w-0 gap-3">
            <span aria-hidden="true" className="font-semibold text-accent">
              {index + 1}
              {index < steps.length - 1 ? " ↓" : ""}
            </span>
            <span className="grid min-w-0 gap-1">
              <strong className="break-words text-primary">{label}</strong>
              <span className="text-caption break-words">{detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

const entities = [
  {
    x: 20,
    y: 20,
    name: "auth.users",
    fields: ["PK id", "Supabase email / identity"],
  },
  {
    x: 380,
    y: 20,
    name: "profiles",
    fields: ["PK / FK id → auth.users", "status; is_admin; is_readonly"],
  },
  {
    x: 740,
    y: 20,
    name: "households",
    fields: [
      "PK id; UNIQUE identifier key",
      "UNIQUE FK representative_profile_id",
    ],
  },
  {
    x: 20,
    y: 220,
    name: "votes",
    fields: [
      "PK id; FK created_by_profile_id",
      "type; status; revision; opens/closes",
    ],
  },
  {
    x: 380,
    y: 220,
    name: "electorate",
    fields: [
      "PK (vote_id, household_id)",
      "FK representative; frozen snapshots",
    ],
  },
  {
    x: 740,
    y: 220,
    name: "participation",
    fields: ["PK / FK (vote_id, household_id)", "accepted_at; NO choices"],
  },
  {
    x: 20,
    y: 420,
    name: "poll_options",
    fields: ["PK id; FK vote_id", "PUBLIC option label / position"],
  },
  {
    x: 380,
    y: 420,
    name: "open_responses",
    fields: [
      "PK (vote_id, household_id, option_id)",
      "FK participation + poll_options",
    ],
  },
  {
    x: 20,
    y: 620,
    name: "offices",
    fields: ["PK id; FK vote_id", "PRIVATE office name / position"],
  },
  {
    x: 380,
    y: 620,
    name: "candidates",
    fields: ["PK id; FK office_id", "candidate name / position"],
  },
  {
    x: 740,
    y: 620,
    name: "closed_tallies",
    fields: [
      "PK id; FK vote / office / candidate",
      "accepted_count; null candidate = NOTA",
    ],
  },
] as const;

export function ErDiagram() {
  return (
    <figure className="grid min-w-0 gap-3">
      <div
        role="region"
        aria-label="Entity relationship diagram, scroll horizontally on small screens"
        tabIndex={0}
        className="overflow-x-auto rounded-control border border-border bg-surface p-3"
      >
        <svg
          role="img"
          aria-labelledby="erd-title erd-description"
          viewBox="0 0 1100 770"
          className="w-full min-w-[48rem] text-primary"
        >
          <title id="erd-title">
            Civic Pulse core entity relationship diagram
          </title>
          <desc id="erd-description">
            Arrows point from referenced parent to referencing child. Auth user
            to profile is one to zero-or-one, profile to current household is
            one to zero-or-one. Votes and households each have many electorate
            entries; an electorate entry has zero-or-one participation. PUBLIC
            participation has many current option responses. PRIVATE offices
            have candidates and aggregate tallies, with no identity-to-tally
            relationship. Text below describes additional keys and settings.
          </desc>
          <g fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M340 70H380 M700 70H740 M540 120V220 M380 95H360V180H180V220 M900 120V170H700V265 M340 265H380 M700 265H740 M180 320V420 M20 270H8V670H20 M340 465H380 M900 320V465H700 M340 665H380 M700 665H740 M180 320V570H900V620 M180 720V745H900V720" />
          </g>
          <g fill="currentColor" fontSize="16">
            <text x="347" y="58">
              →
            </text>
            <text x="708" y="58">
              →
            </text>
            <text x="347" y="253">
              →
            </text>
            <text x="708" y="253">
              →
            </text>
            <text x="347" y="453">
              →
            </text>
            <text x="347" y="653">
              →
            </text>
            <text x="708" y="653">
              →
            </text>
            <text x="550" y="180">
              1 : N
            </text>
            <text x="810" y="190">
              1 : N
            </text>
            <text x="190" y="382">
              1 : N
            </text>
            <text x="750" y="452">
              1 : N ↓
            </text>
            <text x="390" y="562">
              votes → offices / tallies (1 : N)
            </text>
            <text x="390" y="739">
              offices → tallies (1 : N)
            </text>
          </g>
          {entities.map((entity) => (
            <g key={entity.name}>
              <rect
                x={entity.x}
                y={entity.y}
                width="320"
                height="100"
                rx="8"
                className="fill-surface stroke-control-border"
                strokeWidth="2"
              />
              <text
                x={entity.x + 12}
                y={entity.y + 26}
                fill="currentColor"
                fontSize="20"
                fontWeight="bold"
              >
                {entity.name}
              </text>
              {entity.fields.map((field, index) => (
                <text
                  key={field}
                  x={entity.x + 12}
                  y={entity.y + 54 + index * 23}
                  fill="currentColor"
                  fontSize="14"
                >
                  {field}
                </text>
              ))}
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="text-caption">
        PK = primary key; FK = foreign key; UNIQUE = uniqueness constraint.
        Parent → child connectors are foreign-key relationships, not a stored
        PRIVATE ballot trail. The text below gives cardinalities and privacy
        boundaries.
      </figcaption>
    </figure>
  );
}
