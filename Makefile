LIBDIR := lib
include $(LIBDIR)/main.mk

.PHONY: codepoints apply-codepoints update-quic-pick

codepoints: quic-pick/quic-pick.js
	node pick-codepoints.js

apply-codepoints:
	node apply-codepoints.js

update-quic-pick:
	git submodule update --remote quic-pick
	@echo "quic-pick submodule updated — review and commit if changed"

quic-pick/quic-pick.js:
	git submodule update --init quic-pick

$(LIBDIR)/main.mk:
ifneq (,$(shell grep "path *= *$(LIBDIR)" .gitmodules 2>/dev/null))
	git submodule sync
	git submodule update $(CLONE_ARGS) --init
else
	git clone -q --depth 10 $(CLONE_ARGS) \
	    -b main https://github.com/martinthomson/i-d-template $(LIBDIR)
endif
