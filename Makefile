LIBDIR := lib
include $(LIBDIR)/main.mk

QUIC_PICK_URL := https://raw.githubusercontent.com/martinthomson/quic-pick/main/index.html
QUIC_PICK_HTML := quic-pick.html

.PHONY: codepoints apply-codepoints update-quic-pick

codepoints: $(QUIC_PICK_HTML)
	node pick-codepoints.js

apply-codepoints:
	node apply-codepoints.js

update-quic-pick:
	curl -sS -o $(QUIC_PICK_HTML) $(QUIC_PICK_URL)
	@echo "quic-pick.html updated — review and commit if changed"

$(LIBDIR)/main.mk:
ifneq (,$(shell grep "path *= *$(LIBDIR)" .gitmodules 2>/dev/null))
	git submodule sync
	git submodule update $(CLONE_ARGS) --init
else
	git clone -q --depth 10 $(CLONE_ARGS) \
	    -b main https://github.com/martinthomson/i-d-template $(LIBDIR)
endif
