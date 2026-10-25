import { BigButton, Card, Screen } from "@/components/ui";
import { mockFamily, mockRecap } from "@/shared/mock";

// B3 adds the feed items and B5 the full recap card. Mock data until Checkpoint 1.
export default function KidFeed() {
  const { checked, held, needAnswer } = mockRecap;
  return (
    <Screen title="This week">
      <Card>
        <ul className="flex flex-col gap-2 text-xl font-bold">
          <li>{`${checked} checked`}</li>
          <li className="text-fake">{`${held} held`}</li>
          <li className="text-unsure">
            {`${needAnswer} ${needAnswer === 1 ? "needs" : "need"} an answer`}
          </li>
        </ul>
      </Card>
      <BigButton href="/kid/accounts">{`See ${mockFamily.parentName}'s accounts`}</BigButton>
    </Screen>
  );
}
