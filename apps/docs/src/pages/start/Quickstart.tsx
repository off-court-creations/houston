import { Surface, Stack, Button, Box, Typography } from "@archway/valet";
import { useNavigate } from "react-router-dom";

export default function QuickstartPage() {
  const navigate = useNavigate();
  return (
    <Surface>
      <Box alignX="center" centerContent>
        <Stack>
          <Typography>Welcome to Valet</Typography>
          <Button onClick={() => navigate("/secondpage")}>
            Go to the other page
          </Button>
          <Button variant="outlined" onClick={() => navigate("/workspace/new")}>
            Create a Houston workspace
          </Button>
          <Button
            variant="outlined"
            onClick={() => navigate("/workspace/info")}
          >
            View workspace info
          </Button>
          <Button variant="outlined" onClick={() => navigate("/tickets")}>
            Browse tickets
          </Button>
          <Button variant="outlined" onClick={() => navigate("/planner")}>
            Backlog planner
          </Button>
        </Stack>
      </Box>
    </Surface>
  );
}
