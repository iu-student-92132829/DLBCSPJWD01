import app from "./express.js";
import { PORT } from "./setup.js";

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
