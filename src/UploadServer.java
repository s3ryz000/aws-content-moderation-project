import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;

import java.io.*;
import java.net.InetSocketAddress;
import java.nio.file.*;

/**
 * UploadServer.java
 * 
 * bro we are just spinning up a tiny server not launching nasa
 * 
 * This serves the static frontend files (HTML, CSS, JS) and
 * exposes a /status endpoint so the frontend knows we are alive.
 * 
 * No frameworks, no Spring Boot, no AWS SDK — just raw Java.
 */
public class UploadServer {

    // port we run on — change if something else is using 8080
    private static final int PORT = 8080;

    // path to the web folder relative to where you run the java command
    private static final String WEB_ROOT = "web";

    /**
     * Starts the HTTP server.
     * Called from Main.java so everything is clean and separated.
     */
    public void start() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);

        // this endpoint exists so the frontend can know we are in prototype mode
        server.createContext("/status", new StatusHandler());

        // serve all frontend files — html, css, js, images, whatever
        server.createContext("/", new StaticFileHandler());

        // use default executor (single-threaded is fine for a prototype lol)
        server.setExecutor(null);
        server.start();

        System.out.println("===========================================");
        System.out.println("  AWS Content Moderation Prototype Server");
        System.out.println("===========================================");
        System.out.println("  Server running on: http://localhost:" + PORT);
        System.out.println("  Status endpoint:   http://localhost:" + PORT + "/status");
        System.out.println("  Serving files from: " + new File(WEB_ROOT).getAbsolutePath());
        System.out.println("===========================================");
        System.out.println("  Press Ctrl+C to stop the server.");
        System.out.println("===========================================");
    }

    // =========================================================
    //  /status handler
    //  returns a simple JSON so the frontend can check if
    //  the backend is alive
    // =========================================================
    static class StatusHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            // only allow GET for this endpoint, we aint doing post requests here
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(405, -1); // method not allowed
                return;
            }

            String response = "{\"status\": \"online\", \"message\": \"AWS integration not connected yet. Prototype mode only.\"}";
            byte[] bytes = response.getBytes("UTF-8");

            exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
            exchange.sendResponseHeaders(200, bytes.length);

            OutputStream os = exchange.getResponseBody();
            os.write(bytes);
            os.close();
        }
    }

    // =========================================================
    //  Static file handler
    //  serves everything inside the /web folder
    //  basically a mini web server — ghetto but it works
    // =========================================================
    static class StaticFileHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String path = exchange.getRequestURI().getPath();

            // if they hit the root, give them index.html
            if ("/".equals(path)) {
                path = "/index.html";
            }

            // build the file path
            File file = new File(WEB_ROOT + path);

            // make sure the file exists and is actually a file (not a folder)
            if (!file.exists() || !file.isFile()) {
                // 404 not found — file does not exist
                String notFound = "404 — File not found: " + path;
                byte[] bytes = notFound.getBytes("UTF-8");
                exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=UTF-8");
                exchange.sendResponseHeaders(404, bytes.length);
                OutputStream os = exchange.getResponseBody();
                os.write(bytes);
                os.close();
                return;
            }

            // figure out the content type based on file extension
            String contentType = getContentType(file.getName());
            exchange.getResponseHeaders().set("Content-Type", contentType);

            // read the file and send it
            byte[] fileBytes = Files.readAllBytes(file.toPath());
            exchange.sendResponseHeaders(200, fileBytes.length);

            OutputStream os = exchange.getResponseBody();
            os.write(fileBytes);
            os.close();
        }

        /**
         * Returns the MIME type for common web file extensions.
         * bro we only need like 5 types for this project chill
         */
        private String getContentType(String fileName) {
            if (fileName.endsWith(".html"))  return "text/html; charset=UTF-8";
            if (fileName.endsWith(".css"))   return "text/css; charset=UTF-8";
            if (fileName.endsWith(".js"))    return "application/javascript; charset=UTF-8";
            if (fileName.endsWith(".png"))   return "image/png";
            if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) return "image/jpeg";
            if (fileName.endsWith(".gif"))   return "image/gif";
            if (fileName.endsWith(".webp"))  return "image/webp";
            if (fileName.endsWith(".ico"))   return "image/x-icon";
            if (fileName.endsWith(".json"))  return "application/json; charset=UTF-8";
            return "application/octet-stream";
        }
    }
}
