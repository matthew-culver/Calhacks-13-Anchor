import { Card, Screen } from "@/components/ui";
import { mockAccounts, mockFamily } from "@/shared/mock";

// B4 builds the full kid and parent versions. Mock data until Checkpoint 1.
export default function KidAccounts() {
  return (
    <Screen title={`${mockFamily.parentName}'s accounts`}>
      <ul className="flex flex-col gap-4">
        {mockAccounts.map((a) => (
          <li key={a._id}>
            <Card>
              <h2 className="text-xl font-bold">{a.orgName}</h2>
              {/* Only the verified login page from our directory, never a link from an email. */}
              {a.loginUrl && (
                <a
                  href={a.loginUrl}
                  className="mt-2 inline-flex min-h-tap items-center font-bold text-action underline"
                  rel="noopener noreferrer"
                >
                  {`Go to ${a.orgName}`}
                </a>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
