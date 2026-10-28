import { Task, TaskContent, TaskItem, TaskItemFile, TaskTrigger } from "@/components/ai-elements/task";
import { Eyebrow, Lede, SectionTitle, TimelineSection } from "./timeline-section";

export function PipelineSection() {
  return (
    <TimelineSection id="pipeline" labelledBy="pipeline-title" className="flex flex-wrap gap-x-16 gap-y-10">
      <div className="min-w-0 flex-[1_1_320px]">
        <Eyebrow>02 · pipeline</Eyebrow>
        <SectionTitle id="pipeline-title" className="max-w-[14ch]">
          Six steps. Any regression stops the PR.
        </SectionTitle>
        <Lede className="max-w-[42ch]">
          Shim holds itself to your repo&apos;s own gates, then asks a second agent what the gates can&apos;t see. If
          anything regressed, you get an issue, not a PR.
        </Lede>
      </div>

      <Task className="min-w-0 flex-[1.4_1_520px] self-start">
        <TaskTrigger title="Upgrade to AI SDK 7" meta="6 of 6" />
        <TaskContent>
          <TaskItem status="done" title="Baseline" file={<TaskItemFile>install --ignore-scripts</TaskItemFile>}>
            Run the repo&apos;s own typecheck and tests. Only gates green at baseline count.
          </TaskItem>
          <TaskItem status="done" title="Upgrade" file={<TaskItemFile>ai@^7 · @ai-sdk/codemod v7</TaskItemFile>}>
            Bump the dependency and let the official codemod do the renames.
          </TaskItem>
          <TaskItem status="done" title="Find" file={<TaskItemFile>ts-morph</TaskItemFile>}>
            Follow result variables and onFinish events to every read whose meaning changed.
          </TaskItem>
          <TaskItem status="done" title="Fix" file={<TaskItemFile>rules → agent</TaskItemFile>}>
            Deterministic rewrites first. A headless agent handles the rest, with several candidates in parallel.
          </TaskItem>
          <TaskItem status="done" title="Check" file={<TaskItemFile>baseline gates</TaskItemFile>}>
            Every gate that passed at baseline must still pass.
          </TaskItem>
          <TaskItem status="in-progress" title="Judge" file={<TaskItemFile>independent reviewer</TaskItemFile>}>
            A separate agent reads the diff for behavior changes. Approve: PR. Reject or regress: issue.
          </TaskItem>
        </TaskContent>
      </Task>
    </TimelineSection>
  );
}
