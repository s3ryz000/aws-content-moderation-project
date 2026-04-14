public class Main {

    public static void main(String[] args) {

        // let them know we are booting up
        System.out.println("Starting AWS Content Moderation Prototype...");

        try {
            // create the server and fire it up
            UploadServer server = new UploadServer();
            server.start();

        } catch (Exception e) {
            // if something goes wrong we print the error and dip
            System.err.println("===========================================");
            System.err.println("  ERROR: Failed to start the server!");
            System.err.println("  " + e.getMessage());
            System.err.println("===========================================");
            System.err.println("  Make sure port 8080 is not already in use.");
            System.err.println("  Try: lsof -i :8080  (on Mac/Linux)");
            System.err.println("===========================================");
            e.printStackTrace();
            System.exit(1);
        }
    }
}
