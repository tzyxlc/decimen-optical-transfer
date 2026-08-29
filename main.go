// Embedded HTTPS (and optional HTTP) server for the built site in dist/.
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Prerequisite: `npm run build` so dist/index.html exists, then:
//
//	go run .
//	go build -o decimen-server.exe .
//
// HTTPS is the default because getUserMedia is stripped on insecure origins;
// a phone on the LAN cannot use the receiver over plain HTTP.

package main

import (
	"crypto/tls"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

//go:embed all:dist
var embeddedDist embed.FS

func init() {
	_ = mime.AddExtensionType(".wasm", "application/wasm")
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

func main() {
	log.SetFlags(0)

	useTLS := flag.Bool("tls", true, "serve HTTPS (required for the camera on a phone)")
	addr := flag.String("addr", "", "listen address (default :8443 with TLS, :8080 without)")
	certFile := flag.String("cert", "", "TLS certificate PEM (generated and cached if empty)")
	keyFile := flag.String("key", "", "TLS private key PEM (generated and cached if empty)")
	verbose := flag.Bool("v", false, "log each request")
	flag.Parse()

	if *addr == "" {
		if *useTLS {
			*addr = ":8443"
		} else {
			*addr = ":8080"
		}
	}
	if (*certFile == "") != (*keyFile == "") {
		log.Fatal("-cert and -key must be set together")
	}
	if !*useTLS && (*certFile != "" || *keyFile != "") {
		log.Fatal("-cert/-key require -tls")
	}

	site, err := siteFS()
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/__cert.pem", serveCertPEM)
	mux.Handle("/", withCacheHeaders(http.FileServer(http.FS(noList{site}))))
	var handler http.Handler = mux
	if *verbose {
		handler = logRequests(handler)
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatalf("listen %s: %v", *addr, err)
	}

	scheme := "http"
	if *useTLS {
		scheme = "https"
		tlsCfg, err := serverTLS(*certFile, *keyFile)
		if err != nil {
			log.Fatal(err)
		}
		ln = tls.NewListener(ln, tlsCfg)
	}

	printURLs(scheme, ln.Addr().String())
	if *useTLS {
		log.Print("iPhone: open the https network URL (not http). Camera is blocked on plain HTTP.")
		log.Print("Self-signed cert — accept the warning once. iOS 14: download /__cert.pem and enable it in Certificate Trust Settings.")
	} else {
		log.Print("Plain HTTP: the receiver camera works on localhost only, not from a phone.")
	}

	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Fatal(srv.Serve(ln))
}

func withCacheHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if p == "/" || strings.HasSuffix(p, "/") || strings.HasSuffix(p, ".html") || strings.HasSuffix(p, "sw.js") {
			w.Header().Set("Cache-Control", "no-store")
		} else if strings.Contains(p, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		next.ServeHTTP(w, r)
	})
}

func siteFS() (fs.FS, error) {
	sub, err := fs.Sub(embeddedDist, "dist")
	if err != nil {
		return nil, fmt.Errorf("embed dist/: %w", err)
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, errors.New("embedded dist/ has no index.html — run `npm run build`, then rebuild this binary")
		}
		return nil, err
	}
	return sub, nil
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

// noList hides directory listings when a folder has no index.html.
type noList struct{ fs.FS }

func (n noList) Open(name string) (fs.File, error) {
	f, err := n.FS.Open(name)
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if !st.IsDir() {
		return f, nil
	}
	return hiddenDir{f}, nil
}

type hiddenDir struct{ fs.File }

func (hiddenDir) ReadDir(int) ([]fs.DirEntry, error) { return nil, io.EOF }

func (d hiddenDir) Readdir(int) ([]os.FileInfo, error) {
	return nil, io.EOF
}

func printURLs(scheme, bound string) {
	host, port, err := net.SplitHostPort(bound)
	if err != nil {
		log.Printf("Listening on %s://%s/", scheme, bound)
		return
	}

	log.Print("Decimen Optical Transfer")
	seen := map[string]bool{}
	add := func(label, h string) {
		if h == "" || seen[h] {
			return
		}
		seen[h] = true
		log.Printf("  %-8s %s://%s/", label, scheme, net.JoinHostPort(h, port))
	}

	if host == "" || host == "0.0.0.0" || host == "::" {
		add("local", "127.0.0.1")
		for _, ip := range outboundIPs() {
			add("network", ip)
		}
		return
	}
	add("listen", host)
}

func outboundIPs() []string {
	var ips []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return ips
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok || ipnet.IP.IsLoopback() {
				continue
			}
			if v4 := ipnet.IP.To4(); v4 != nil {
				ips = append(ips, v4.String())
			}
		}
	}
	return ips
}

func serverTLS(certFile, keyFile string) (*tls.Config, error) {
	var cert tls.Certificate
	var err error
	if certFile != "" {
		cert, err = tls.LoadX509KeyPair(certFile, keyFile)
	} else {
		cert, err = loadOrCreateCert()
	}
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
		NextProtos:   []string{"h2", "http/1.1"},
	}, nil
}
