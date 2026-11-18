import "@fontsource/open-sans";
import "@fontsource/titillium-web";
import { useUser } from "../../hooks/use-user";
import { Icons } from "@/components/icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export const ProfileImage = () => {
  const { user } = useUser();

  if (user?.email) {
    const initial = (user.user_metadata?.full_name ?? user.email ?? "?")
      .charAt(0)
      .toUpperCase();
    return (
      <Avatar className="size-6">
        <AvatarImage src={user.user_metadata?.avatar_url} alt="Profile image" />
        <AvatarFallback className="bg-accent text-xs font-medium text-accent-foreground">
          {initial}
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <span className="flex size-6 items-center justify-center rounded-full bg-background">
      <Icons.google className="size-4" />
    </span>
  );
};
